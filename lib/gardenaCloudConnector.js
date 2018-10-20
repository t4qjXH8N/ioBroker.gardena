"use strict";

let adapter;

const request = require('request');  // for communication

const min_polling_interval = 60; // minimum polling interval in seconds

const gardenaDBConnector = require(__dirname + '/gardenaDBConnector');

// gardena cloud config
const gardena_config = {
  "baseURI": "https://sg-api.dss.husqvarnagroup.net",
  "devicesURI": "/sg-1/devices",
  "sessionsURI": "/sg-1/sessions",
  "locationsURI": "/sg-1/locations",
  "abilitiesURI": "/abilities"
};

// auth data (tokens etc.)
let auth = {
  "token": null,
  "user_id": null,
  "refresh_token": null
};

// holds the last data from the cloud
let cloud_data = {
  'locations': null,
  'datapoints': []
};

let conn_timeout_id = null; // timeout interval id
let update_locations_counter = 30; // update locations in the database with this interval (saves resources)

exports.setAdapter = function(adapter_in) {
  adapter = adapter_in;
};

// connect to gardena smart cloud service
exports.connect = function(username, password, callback) {
  adapter.log.info("Connecting to Gardena Smart System Service ...");

  if(!username || typeof username === 'function') {
    username = adapter.config.gardena_username;
  }

  if(!password || typeof password === 'function') {
    password = adapter.config.gardena_password;
  }

  let options_connect = {
    url: gardena_config.baseURI + gardena_config.sessionsURI,
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST",
    json: {
      "sessions": {
        "email": username,
        "password": password
      }
    }
  };

  request(options_connect, function(err, response, body){
    if(err || !response) {
      // no connection or auth failure
      adapter.log.error(err);
      adapter.log.info('Connection failure.');
      adapter.setState('info.connection', false);

      auth = {
        user_id: null,
        token: null,
        refresh_token: null
      };

      if(callback) callback(err, auth);
    } else {
      // connection successful
      adapter.log.debug('Response: ' + response.statusMessage);

      // connection established but auth failure
      if(response.statusMessage === 'Unauthorized') {
        auth = {
          user_id: null,
          token: null,
          refresh_token: null
        };

        adapter.setState('info.connection', false);
        adapter.log.debug('Deleted auth tokens.');
        adapter.log.error('Connection works, but authorization failure (wrong password?)!');
        if(callback) callback(err, auth);
      } else {
        // save tokens etc.
        if(body && body.hasOwnProperty('sessions')
          && body.sessions.hasOwnProperty('user_id')
          && body.sessions.hasOwnProperty('token')
          && body.sessions.hasOwnProperty('refresh_token')) {

          auth = {
            user_id: body.sessions.user_id,
            token: body.sessions.token,
            refresh_token: body.sessions.refresh_token
          };

          adapter.setState('info.connection', true);
          adapter.log.debug('Saved auth tokens.');
          if (callback) callback(false, auth);
        } else {
          adapter.log.debug('No auth data received');
          adapter.setState('info.connection', false);
          if (callback) callback('No auth data received');
        }
      }
    }
  });
};

// disconnect from gardena cloud (i.e. clear all tokens)
exports.disconnect = function(callback) {
  auth = {
    "token": null,
    "user_id": null,
    "refresh_token": null
  };

  if(callback) callback(false);
};

// poll locations, devices, etc.
exports.poll = function(callback) {
  // first poll the locations (if the counter says we should do so)
  if(update_locations_counter === 30) {
    adapter.log.info('Polling locations.');
    exports.retrieveLocations(auth.token, auth.user_id, function (err, locations) {
      if (err || !locations) {
        adapter.log.error('Error retrieving the locations.')
      } else {
        cloud_data.locations = locations;
        gardenaDBConnector.updateDBLocations(locations);
        adapter.log.info('Updated locations in the database.');
      }
      adapter.log.debug('Retrieved all locations.');
      update_locations_counter = 0;
    });
  }
  update_locations_counter += 1;

  // poll datapoints for devices for all locations
  adapter.getStates(gardenaDBConnector.getloc_prefix() + '*', function (err, states) {
    if(err) {
      adapter.log.error(err);
      return
    }
    // get distinct locations
    let locations = [];
    for(let cloc in states) {
      if(!locations.includes(cloc.split('.')[3])) {
        locations.push(cloc.split('.')[3]);
      }
    }

    // get devices for all locations
    for(let i=0;i<locations.length;i++) {
      exports.retrieveDevicesFromLocation(auth.token, locations[i], function (err, devices) {
        if (err) {
          adapter.log.error('Could not get device from location.');
          if (callback) callback(err);
        } else {
          cloud_data.datapoints.push({key: locations[i], value: devices});
          gardenaDBConnector.updateDBDatapoints(locations[i], devices, function (err) {
            if (callback) callback(err);
          });
        }
      });
    }
  });
};

exports.reconnect = function(callback) {
  conn_timeout_id = setTimeout(function () {
    gardena_config.connect(function(err, auth_data) {
      if(!err) {
        auth = auth_data;
      } else {
        adapter.log.error(err);
      }
    });
  }, Number(adapter.config.gardena_reconnect_interval) * 1000);

  if(callback) callback(false);
};

exports.setupPolling = function(connection_state, callback) {
  if (Number(adapter.config.gardena_polling_interval)*1000 < min_polling_interval) {
    adapter.log.error('Polling interval should be greater than ' + min_polling_interval);
  } else {
    // got connection
    clearTimeout(conn_timeout_id);
    exports.poll();

    // enable polling
    setInterval(function () {exports.poll();}, Number(adapter.config.gardena_polling_interval) * 1000);
  }
  if(callback) callback(false);
};

exports.is_connected = function() {
  return auth.token;
};

exports.get_auth = function () {
  return auth;
};

// send a command to the gardena device
exports.sendCommand = function(id, cmd, deviceid, locationid, callback) {

  getRequestOptionsToSend(id, cmd, deviceid, locationid, function(options) {
    let a = options;

    request(options, function (err, response, jsondata) {
      if (err) {
        adapter.log.error('Could not send command.');
        adapter.setState('info.connection', false);

        callback(err);
      } else {
        adapter.log.info('Command send.');

        // reset command switch to false
        adapter.setState('devices.' + deviceid + '.commands.' + cmd + '.send', false, false);
        callback(false);
      }
    });
  });
}

// retrieve locations
exports.retrieveLocations = function(token, user_id, callback) {
  // setup the request
  let options = {
    url: gardena_config.baseURI + gardena_config.locationsURI + '/?user_id=' + user_id,
    headers: {
      "Content-Type": "application/json",
      "X-Session": token
    },
    method: "GET",
    json: true
  };

  request(options, function (err, response, jsondata) {
    if (err) {
      adapter.setState('info.connection', false);
      adapter.log.error('Could not retrieve locations.');

      callback(err);
    } else {
      callback(false, jsondata);
    }
  });
};

// get device device data for a location
exports.retrieveDevicesFromLocation = function(token, location_id, callback) {

  // setup request
  let options = {
    url: gardena_config.baseURI + gardena_config.devicesURI + '/?locationId=' + location_id,
    headers: {
      "Content-Type": "application/json",
      "X-Session": token
    },
    method: "GET",
    json: true
  };

  request(options, function (err, response, jsondata) {
    if (err) {
      adapter.setState('info.connection', false);
      adapter.log.debug('Could not retrieve devices.');
      callback(err);
    } else {
      adapter.log.info('Retrieved device data.');
      callback(err, jsondata);
    }
  });
};

// create json that we have to send to the device
function getJSONToSend(id, cmd, deviceid, callback) {

  function getCmdNamespace(id) {
    let cmd_namespace = '';
    for(let i=0;i<id.split('.').length - 1;i++) {
      cmd_namespace += id.split('.')[i];
      if(i < (id.split('.').length - 2)) cmd_namespace += '.';
    }
    return cmd_namespace;
  }

  function getDeviceNamespace(id, deviceid) {
    let dev_namespace = '';
    let dev_id;

    for(let i=0;i<id.split('.').length;i++) {
      if(id.split('.')[i] === deviceid) {
        dev_id = i;
        break;
      }
    }

    for(let i=0;i<dev_id+1;i++) {
      dev_namespace += id.split('.')[i];
      if(i < dev_id) dev_namespace += '.';
    }
    return dev_namespace;
  }

  function removeNamespace(id) {
    let rest = '';
    // remove namespace
    for(let i = 5;i< id.split('.').length; i++) {
      rest += id.split('.')[i];
      if (i < id.split('.').length - 1) rest += '.';
    }
    return rest;
  }

  function removeFirstElement(id) {
    let rest = '';
    for (let i = 1; i < id.split('.').length; i++) {
      rest += id.split('.')[i];
      if (i < id.split('.').length - 1) rest += '.';
    }

    return rest;
  }

  function removeLastElement(id) {
    let rest = '';
    for(let i=0;i<id.split('.').length - 1;i++) {
      rest += id.split('.')[i];
      if (i < id.split('.').length - 2) rest += '.';
    }

    return rest;
  }

  function paramToDict(id, cobj) {
    // get first element of the id

    if (id.split('.').length === 1) {
      let dict = {};
      dict[id] = cobj.val;
      return dict;
    } else {
      let dict = {};

      dict[id.split('.')[0]] = paramToDict(removeFirstElement(id), cobj);
      return dict;
    }
  }

  let cmd_namespace = getCmdNamespace(id);
  let dev_namespace = removeNamespace(id);

  // get values for parameters from the database
  adapter.getForeignStates(cmd_namespace + '.*', function (err, objs) {
    let json2send = {};
    let rest;

    // add modified activator state to objs, so that paramToDict works
    let dict = {};
    dict[removeLastElement(id) + '.name'] = {"val": cmd};
    objs = Object.assign({}, objs, dict);

    // first find the activator state
    for(let cobj in objs) {
      if(cobj.split('.')[cobj.split('.').length - 1] !== 'send') {
        // no activator state
        rest = removeFirstElement(removeNamespace(cobj, cmd_namespace));

        // merge parameters into json2send
        let jo = paramToDict(rest, objs[cobj]);
        json2send = deepmerge(json2send, jo);
      }
    }

    callback(json2send);
  });
}

// should we keep this function?
// helper function for preparing the request options
function getRequestOptionsToSend(id, cmd, deviceid, locationid, callback) {
  // get category of the gardena device
  adapter.getState(adapter.namespace + '.devices.' + deviceid + '.category', function(err, category) {
    if (err || !category) {
      callback(err);
    } else {
      getJSONToSend(id, cmd, deviceid, function (json2send) {
        // get URI
        let g_cmds = gardena_commands[category.val];

        if(!g_cmds.hasOwnProperty('request') || !g_cmds.request == Object) {
          adapter.log.error('Missing request in gardena_commands.json');
          return
        }
        if(!g_cmds.request.hasOwnProperty('uri') || !g_cmds.request.uri) {
          adapter.log.error('Missing "uri" in request in gardena_commands.json');
          return
        }
        if(!g_cmds.request.hasOwnProperty('method') || !g_cmds.request.method) {
          adapter.log.error('Missing "method" in request in gardena_commands.json');
          return
        }

        let uri = gardena_config.baseURI + g_cmds.request.uri.replace('[deviceID]', deviceid).replace('[locationID]', locationid).replace('[cmd]', cmd);
        let method = g_cmds.request.method;

        let options = {
          url: uri,
          headers: {
            "Content-Type": "application/json",
            "X-Session": auth.token
          },
          method: method,
          json: json2send
        };

        callback(options);

      });
    }
  });
}
