"use strict";

let adapter;

const request = require('request');  // for communication

const min_polling_interval = 60; // minimum polling interval in seconds

const gardenaDBConnector = require(__dirname + '/gardenaDBConnector');

let gardena_base_URI;

// gardena cloud config
const gardena_api_config = {
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

exports.get_gardena_config = function() {
  gardena_api_config.baseURI = adapter.config.baseURI;
  gardena_api_config.gardena_autopoll = adapter.config.gardena_autopoll;
  gardena_api_config.gardena_autopoll_delay = adapter.config.gardena_autopoll_delay;
  return gardena_api_config;
};

exports.get_cloud_data = function() {
  return cloud_data;
};

exports.setAdapter = function(adapter_in) {
  adapter = adapter_in;
};

// connect to gardena smart cloud service
exports.connect = function(baseURI, username, password, callback) {
  adapter.log.info("Connecting to Gardena Smart System Service at " + baseURI + " ...");

  if(!baseURI || typeof baseURI === 'function') {
    baseURI = adapter.config.baseURI;
    gardena_base_URI = baseURI;
  }

  if(!username || typeof username === 'function') {
    username = adapter.config.gardena_username;
  }

  if(!password || typeof password === 'function') {
    password = adapter.config.gardena_password;
  }

  let options_connect = {
    url: baseURI + gardena_api_config.sessionsURI,
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
  if(update_locations_counter === update_locations_counter) {
    adapter.log.debug('Polling locations.');
    exports.retrieveLocations(auth.token, auth.user_id, function (err, locations) {
      if (err || !locations) {
        adapter.log.error('Error retrieving the locations.');
      } else {
        cloud_data.locations = locations;
        gardenaDBConnector.updateDBLocations(locations);
        adapter.log.debug('Update locations in the database.');
      }
      update_locations_counter = 0;
    });
  }
  update_locations_counter += 1;

  // poll datapoints for devices for all locations
  adapter.getStates(gardenaDBConnector.getloc_prefix() + '*', function (err, states) {
    if(err) {
      adapter.log.error(err);
      if(callback) callback(err);
      return;
    }
    // get distinct locations
    let locations = [];
    for(let cloc in states) {
      if(!locations.includes(cloc.split('.')[3])) {
        locations.push(cloc.split('.')[3]);
      }
    }

    // get devices for all locations
    let locations_todo = locations.length;
    cloud_data = {
      'locations': null,
      'datapoints': []
    };

    for(let i=0;i<locations.length;i++) {
      exports.retrieveDevicesFromLocation(auth.token, locations[i], function (err, devices) {
        if (err) {
          adapter.log.error('Could not get device from location.');
        } else {
          cloud_data.datapoints.push({key: locations[i], value: devices});
          gardenaDBConnector.updateDBDatapoints(locations[i], devices, function (err) {});

          locations_todo--;
          if(locations_todo === 0) {
            // we have all locations in the cloud_data variable
            if (callback) callback(false);
          }
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

// retrieve locations
exports.retrieveLocations = function(token, user_id, callback) {
  // setup the request
  let options = {
    url: gardena_base_URI + this.get_gardena_config().locationsURI + '/?user_id=' + user_id,
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
    url: gardena_base_URI + this.get_gardena_config().devicesURI + '/?locationId=' + location_id,
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
      adapter.log.debug('Successfully retrieved device data.');
      callback(err, jsondata);
    }
  });
};

exports.http_put = function(uri, json2send, callback) {
  let options = {
    url: uri,
    headers: {
      "Content-Type": "application/json",
      "X-Session": auth.token
    },
    method: "put",
    json: json2send
  };

  adapter.log.debug('Sending command via HTTP put.');
  adapter.log.debug('URI: ' + uri);
  adapter.log.debug('Dataframe: ' + JSON.stringify(json2send));

  request(options, function (err, response, jsondata) {
    if (err) {
      adapter.setState('info.connection', false);
      adapter.log.error('Could not send command to uri ' + uri + '.');

      if(callback) callback(err);
    } else {
      adapter.log.debug('Command send successfully! Answer: ' + JSON.stringify(jsondata));
      if(callback) callback(false, jsondata);
    }
  });
};

exports.http_post = function(uri, json2send, callback) {
  let options = {
    url: uri,
    headers: {
      "Content-Type": "application/json",
      "X-Session": auth.token
    },
    method: "post",
    json: json2send
  };

  adapter.log.debug('Sending command via HTTP post.');
  adapter.log.debug('URI: ' + uri);
  adapter.log.debug('Dataframe: ' + JSON.stringify(json2send));

  request(options, function (err, response, jsondata) {
    if (err) {
      adapter.setState('info.connection', false);
      adapter.log.error('Could not send command to uri ' + uri + '.');

      if(callback) callback(err);
    } else {
      adapter.log.debug('Command send successfully! Answer: ' + JSON.stringify(jsondata));
      if(callback) callback(false, jsondata);
    }
  });
};
