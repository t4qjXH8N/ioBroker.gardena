/**
 *
 * gardena smart system adapter
 *
 */

/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

// you have to require the utils module and call adapter function
const utils =    require(__dirname + '/lib/utils'); // Get common adapter utils

// for communication
const request = require('request');

const deepmerge = require('deepmerge');

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.gardena.0
const adapter = utils.Adapter('gardena');

// gardena commands
const gardena_commands = require(__dirname + '/gardena_commands.json');

const min_polling_interval = 60; // minimum polling interval in seconds

// gardena config
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

let conn_timeout_id = null;

// triggered when the adapter is installed
adapter.on('install', function () {
  // create connection variable https://github.com/ioBroker/ioBroker/wiki/Adapter-Development-Documentation#infoconnection
});

// is called when the adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
  try {
    adapter.log.info('cleaned everything up...');
      callback();
  } catch (e) {
      callback();
  }
});

// is called if a subscribed object changes
adapter.on('objectChange', function (id, obj) {
  // Warning, obj can be null if it was deleted
  adapter.log.debug('objectChange ' + id + ' ' + JSON.stringify(obj));
});

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
  // Warning, state can be null if it was deleted
  adapter.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));

  // connection related state change
  if(id && state && id === state.from.split('.')[2]+'.'+state.from.split('.')[3] + '.' + 'info.connection') {
    adapter.log.debug('Change in connection detected.');

      if (Number(adapter.config.gardena_polling_interval)*1000 < min_polling_interval) {
        adapter.log.error('Polling interval should be greater than ' + min_polling_interval);
      } else {
        if (state.val === true) {
          // got connection
          clearTimeout(conn_timeout_id);
          poll(function () {
          });
          // enable polling
          setInterval(function () {
            poll(function (err) {

            });
          }, Number(adapter.config.gardena_polling_interval) * 1000);
        } else {
          // lost connection
          connect(function(err, auth_data) {
            auth = auth_data;
          });

          conn_timeout_id = setTimeout(function () {
            connect(function(err, auth_data) {
              auth = auth_data;
            });
          }, Number(adapter.config.gardena_reconnect_interval) * 1000);
        }
      }
  }

  // you can use the ack flag to detect if it is status (true) or command (false)
  if (state && state.val && !state.ack) {
    adapter.log.debug('ack is not set!');

    triggeredEvent(id, state, function (err) {
      if(err) adapter.log.error('An error occurred during trigger!')
    });
  }
});

// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', function () {
  adapter.setObjectNotExists('info.connection', {
    type: 'state',
    common: {
      name: 'connected',
      desc: 'Connected to Gardena Smart System Service?',
      type: 'boolean',
      def: 'false',
      read: 'true',
      role: 'value.info',
      write: 'false'
    },
    native: {}
  });

  // start main function
  main();
});


// messages
adapter.on('message', function (obj) {
  let wait = false;
  let credentials;
  let msg;

  if (obj) {
    switch (obj.command) {
      case 'checkConnection':
        credentials = JSON.parse(obj.message);

        connect(credentials.gardena_username, credentials.gardena_password, function (err) {
          if (!err) {
            adapter.sendTo(obj.from, obj.command, true, obj.callback);
          } else {
            adapter.sendTo(obj.from, obj.command, false, obj.callback);
          }
        });
        wait = true;
        break;
      case 'connect':
        credentials = obj.message;

        connect(credentials.gardena_username, credentials.gardena_password, function (err, auth_data) {
          if (!err) {
            adapter.sendTo(obj.from, obj.command, auth_data, obj.callback);
          } else {
            adapter.sendTo(obj.from, obj.command, false, obj.callback);
          }
        });
        wait = true;
        break;
      case 'retrieveLocations':
        msg = obj.message;

        retrieveLocations(msg.token, msg.user_id, function (err, locations) {
          if(!err) {
            adapter.sendTo(obj.from, obj.command, locations, obj.callback);
          } else {
            adapter.sendTo(obj.from, obj.command, false, obj.callback);
          }
        });
        wait = true;
        break;
      case 'retrieveDevices':
        msg = obj.message;

        retrieveDevicesFromLocation(msg.token, msg.location_id, function (err, devices) {
          if(!err) {
            adapter.sendTo(obj.from, obj.command, devices, obj.callback);
          } else {
            adapter.sendTo(obj.from, obj.command, false, obj.callback);
          }
        });
        wait = true;
        break;
      default:
        adapter.log.warn("Unknown command: " + obj.command);
        break;
    }
  }
  if (!wait && obj.callback) {
    adapter.sendTo(obj.from, obj.command, obj.message, obj.callback);
  }

  return true;
});


// main function
function main() {

  // The adapters config (in the instance object everything under the attribute "native") is accessible via
  // adapter.config:
  adapter.log.info('Starting gardena smart system adapter');

  // check setup
  //syncConfig();

  // connect to gardena smart system service
  connect();

  // gardena subscribes to all state changes
  adapter.subscribeStates('devices.*.commands.*.send');
  adapter.subscribeStates('info.connection');
}

// connect to gardena smart cloud service
function connect(username, password, callback) {
  adapter.log.info("Connecting to Gardena Smart System Service ...");

  if(!username) username = adapter.config.gardena_username;
  if(!password) password = adapter.config.gardena_password;

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
      adapter.setState('info.connection', false, function() {});

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

        adapter.setState('info.connection', false, function() {});
        adapter.log.debug('Deleted auth tokens.');
        adapter.log.error('Connection works, but authorization failure (wrong password?)!');
        if(callback) callback(err, auth);
      } else {
        // save tokens etc.
        auth = {
          user_id: body.sessions.user_id,
          token: body.sessions.token,
          refresh_token: body.sessions.refresh_token
        };

        adapter.setState('info.connection', true);
        adapter.log.debug('Saved auth tokens.');
        adapter.log.info('Connection successful.');
        if(callback) callback(false, auth);
      }
    }
  });
}

// poll locations, devices, etc.
function poll(callback) {

  adapter.log.info('Poll locations.');
  retrieveLocations(auth.token, auth.user_id, function (err, locations) {
    if(err || !locations) {
      adapter.log.error('Error retrieving the locations.')
    } else {
      adapter.log.info('Update DB locations.');
      updateDBLocations(locations, function (err) {
        if (err) {
          callback(err)
        } else {
          callback(false)
        }
      });
      // get all devices and create iobroker tables
      adapter.log.debug('Retrieved all locations, get all devices');

      // get all devices and create iobroker tables
      retrieveAllDevicesAndUpdateDB(function (err) {
        if(err) {
          adapter.log.error('An error occured during polling devices.');

          if(callback) callback(err);
        } else {
          adapter.log.info('Polling successful!');

          if(callback) callback(false);
        }
      });
    }
  });
}

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

// send a command to the gardena device
function sendCommand(id, cmd, deviceid, locationid, callback) {

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

// an event was triggered
function triggeredEvent(id, state, callback) {

  let deviceid = id.split('.')[3];
  let cmd = id.split('.')[id.split('.').length - 2];

  // ok, we have the device id, get the location id
  adapter.getState('devices.' + deviceid + '.locationid', function(err, state) {
    if(err) {
      adapter.log.error('Could not get location ID for device ' + deviceid);

      callback(err);
    } else {
      if(state) {
        let locationid = state.val;
        sendCommand(id, cmd, deviceid, locationid, function(err) {
          if(err) {
            adapter.log.error('Could not send command ' + command + ' for device id ' + deviceid);
            callback(true);
          } else {
            callback(false);
          }
        });
      } else {
        callback(false);
      }
    }
  });
}

// retrieve locations
function retrieveLocations(token, user_id, callback) {
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
}

// update locations in database
function updateDBLocations(jsondata, callback) {
  adapter.createDevice('locations', {
    name: 'locations'
  });

  // update locations in the database
  for(let ckey in jsondata) {
    if (jsondata.hasOwnProperty(ckey) && ckey === 'locations') {
      let locations = jsondata[ckey];

      // go through all locations
      for(let i=0;i<locations.length;i++) {
        let curlocation = locations[i];

        // retrieve location id
        let locid = curlocation['id'];

        if(locid) {
          // maybe it is a valid location id?
          adapter.createChannel('locations', locid, {
            name: locid,
            role: 'gardena.location'
          });

          // go through all properties in locations
          for(let lkey in curlocation) {
            if (curlocation.hasOwnProperty(lkey)) {
              switch(lkey) {
                case 'name':
                  adapter.createState('locations', locid, lkey, {
                    name: lkey,
                    role: 'gardena.name',
                    read: true,
                    write: false,
                    def: curlocation[lkey]
                  });
                  break;
                case 'devices':
                  // save the devices as comma delimited string
                  adapter.createState('locations', locid, 'devices', {
                    name: 'devices',
                    def: curlocation[lkey].toString(),
                    write: false,
                    read: true,
                    role: 'gardena.devices'
                  }, true);
                  break;
                case 'geo_position':
                // go through geoposition
                  for(let cgeo in curlocation[lkey]) {

                    adapter.createState('locations', locid, 'geo_position.' + cgeo, {
                      name: 'geo_position.' + cgeo,
                      def: curlocation[lkey][cgeo],
                      write: false,
                      read: true,
                      role: 'gardena.geo_position'
                    }, true);
                  }
                  break;
              }
            }
          }
        } else {
          adapter.log.error('Invalid location id!');
        }
      }
    }
  }

  callback(false);
}

// get device data for all locations
function retrieveAllDevicesAndUpdateDB(callback) {

  // go through all location ids and retrieve device information
  adapter.getChannelsOf('locations', function (err, channels) {

    for(let i=0;i<channels.length;i++) {
      let location_id = channels[0].common.name;
      retrieveDevicesFromLocation(auth.token, location_id, function (err, jsondata) {
        if (err) {
          callback(err);
        } else {
          adapter.log.error('Could not get device from location ' + location_id);
          updateDBDevices(location_id, jsondata, function (err) {
            if (err) {
              callback(err);
            } else {
              callback(false);
            }
          });
        }
      });
    }
  });
}

// get device device data for a location
function retrieveDevicesFromLocation(token, location_id, callback) {

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
}

function setCommands_to_DB(cdev, prefix, cmd, callback) {

  // check type of command
  // 1. a property or parameter?
  // 2. activator state
  function getCmdType(cmd) {
    if (cmd.hasOwnProperty('name') && cmd.name && cmd.hasOwnProperty('type') && cmd.type && cmd.hasOwnProperty('val') && cmd.val) return 1;
    if (cmd.hasOwnProperty('cmd_desc') && cmd.cmd_desc) return 2;

    return -1;
  }

  // go through all commands
  for (let i=0;i<cmd.length;i++) {
    switch (getCmdType(cmd[i])) {
      case 1:
        // oh, we have a property or parameter here
        // create parameter
        let desc = ((cmd[i].hasOwnProperty('desc') && cmd[i].desc) ? cmd[i].desc : 'description');

        setStateEx(prefix + '.' + cmd[i].name, {
          common: {
            name: cmd[i].name,
            role: 'gardena.command_parameter',
            desc: desc,
            write: true,
            read: true,
            type: cmd[i].type
          }
        }, cmd[i].val, true);

        break;
      case 2:
        // create activator state
        setStateEx(prefix + '.' + cmd[i].cmd_desc + '.send', {
          common: {
            name: 'send ' + cmd[i].cmd_desc,
            role: 'gardena.command_trigger',
            desc: 'Send command ' + cmd[i].cmd_desc + '.',
            write: true,
            read: true,
            def: false,
            type: "boolean"
          }
        }, false, true);
        break;
    }

    // are there any other keys than "cmd_desc" or type that contain arrays?
    for (let citem in cmd[i]) {
      if (Array.isArray(cmd[i][citem]) && cmd[i][citem].length > 0) {
        if(cmd[i].hasOwnProperty('cmd_desc') && cmd[i].cmd_desc) {
          setCommands_to_DB(cdev, prefix + '.' + cmd[i].cmd_desc + '.' + citem, cmd[i][citem], callback)
        } else {
          setCommands_to_DB(cdev, prefix + '.' + citem, cmd[i][citem], callback)
        }
      }
    }
  }
}

// create set commands for device id (if not yet done)
function createSetCommands(cdev, callback) {
  // is there a category present?
  if(!cdev.hasOwnProperty('category') || !cdev.category) {
    callback(false);
    return;
  }

  // is category known by gardena_commands.json?
  let g_cmds = gardena_commands;
  if(!g_cmds.hasOwnProperty(cdev.category) || !g_cmds[cdev.category]) {
    callback(false);
    return;
  }

  // are there any commands?
  if(!g_cmds[cdev.category].hasOwnProperty('commands') || !g_cmds[cdev.category].commands) {
    callback(false);
    return;
  }

  if(!Array.isArray(g_cmds[cdev.category].commands) || !(g_cmds[cdev.category].commands.length > 0)) {
    callback(false);
    return;
  }

  // go recursively through commands array
  setCommands_to_DB(cdev, 'devices.' + cdev.id + '.commands', g_cmds[cdev.category].commands, function (err) {
    if(err) {
      callback(err);
    } else {
      callback(false);
    }
  });
}

// update database devices
function updateDBDevices(location_id, jsondata, callback) {
  // go through all devices
  if(jsondata && jsondata.devices) {
    for(let i=0;i<jsondata.devices.length;i++) {
      let cdev = jsondata.devices[i];

      if(cdev.id) {
        // there seems to be a valid device id
        adapter.setObject('devices.' + cdev.id, {
          type: "device",
          common: {
            name: cdev.category + '_' + cdev.name,
            role: "device"
          },
          native: {}
        });

        JSONtoDB(cdev, 'devices.' + cdev.id);

        // save location id (redundant, but simpler)
        setStateEx('devices.' + cdev.id + '.locationid', {
          common: {
            name: "locationid",
            role: "gardena.locationid",
            write: false,
            read: true,
            type: "string"
          }
        }, location_id, true);

        createSetCommands(cdev, function(err) {
          if(err) adapter.log.error('Error creating set commands for device ' + cdev.id)
        });

      } else {
        adapter.log.debug('Invalid device id!');
      }
    }
    callback(false);
  } else {
    callback('Received JSON is empty.');
  }
}

// synchronize config
function syncConfig() {

}

// write JSON object into DB
function JSONtoDB(json, root_id) {

  for (let citem in json) {
    if (!json.hasOwnProperty(citem)) continue;

    if (Array.isArray(json[citem])) {
      for (let i = 0; i < json[citem].length; i++) {
        let curelem = json[citem][i];

        // check if curelem is an object
        if(typeof curelem === 'object') {
          JSONtoDB(curelem, root_id + '.' + citem + '.' + i);
        } else {
          let d = {};
          d[i] = curelem;
          JSONtoDB(d, root_id + '.' + citem);
        }
      }
    } else if (typeof json[citem] === 'object') {
      JSONtoDB(json[citem], root_id + '.' + citem);
    } else if (typeof json[citem] === 'string') {
      setStateEx(root_id + '.' + citem, {
        common: {
          name: citem,
          write: false,
          read: true,
          type: "string",
          role: "gardena.string"
        }
      }, json[citem], true);
    } else if (typeof json[citem] === 'boolean') {
      setStateEx(root_id + '.' + citem, {
        common: {
          name: citem,
          write: false,
          read: true,
          def: false,
          type: "boolean",
          role: "gardena.boolean"
        }
      }, json[citem], true);
    } else if (typeof json[citem] === 'number') {
      setStateEx(root_id + '.' + citem, {
        common: {
          name: citem,
          write: false,
          read: true,
          type: "number",
          role: "gardena.number"
        }
      }, json[citem], true);
    }
  }
}

// setStateEx
function setStateEx(id, common, val, ack, callback) {
  let a = {
    type: 'state',
    native: {}
  };

  let common_full = Object.assign({}, a, common);

  let cfunc = function (err) {
    adapter.setState(id, val, ack, function(err) {
      if(err) adapter.log.error('Could not create extende state id:' + id + ', val:' + val);
    });
  };

  adapter.setObject(id, common_full, cfunc);

  if(callback) callback(false);
}
