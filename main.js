/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

// you have to require the utils module and call adapter function
const utils =    require(__dirname + '/lib/utils'); // Get common adapter utils

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.gardena.0
const adapter = utils.Adapter('gardena');

const gardena_commands = require(__dirname + '/gardena_commands.json');  // gardena commands

const gardenaCloudConnector = require(__dirname + '/lib/gardenaCloudConnector');
const gardenaDBConnector = require(__dirname + '/lib/gardenaDBConnector');

// triggered when the adapter is installed
adapter.on('install', function () {
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
  if(id && state && id === state.from.split('.')[2] + '.' + state.from.split('.')[3] + '.' + 'info.connection') {
    adapter.log.debug('Change in connection detected, setup polling if true.');

    if (state.val === true) {
      // got connection
      gardenaCloudConnector.setupPolling();
    } else {
      gardenaCloudConnector.reconnect();
    }
  }

  // you can use the ack flag to detect if it is status (true) or command (false)
  if (state && state.val && !state.ack && id.split('.')[id.split('.').length-1] === 'trigger') {
    triggeredEvent(id, state, function (err) {
      if(err) adapter.log.error('An error occurred during trigger!')
    });
  }

  if (state && state.val && !state.ack && id.split('.')[id.split('.').length-1] === 'smart_trigger') {
    triggeredSmartEvent(id, state, function (err) {
      if(err) adapter.log.error('An error occurred during smart trigger!')
    });
  }
});

// is called when databases are connected and adapter received configuration.
adapter.on('ready', function () {
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
        credentials = obj.message;

        function sub_connect() {
          gardenaCloudConnector.connect(credentials.gardena_username, credentials.gardena_password, function (err) {
            if (!err) {
              adapter.sendTo(obj.from, obj.command, true, obj.callback);
            } else {
              adapter.sendTo(obj.from, obj.command, false, obj.callback);
            }
          });
        }

        // is there already a connection?
        if(!gardenaCloudConnector.is_connected()) {
          gardenaCloudConnector.disconnect(function(err) {
            sub_connect();
          });
        } else {
          sub_connect();
        }
        wait = true;
        break;
      case 'connect':
        credentials = obj.message;

        // check if already connected (do not care about the credentials)
        if(!gardenaCloudConnector.is_connected()) {
          gardenaCloudConnector.connect(credentials.gardena_username, credentials.gardena_password, function (err, auth_data) {
            if (!err) {
              adapter.sendTo(obj.from, obj.command, auth_data, obj.callback);
            } else {
              adapter.sendTo(obj.from, obj.command, false, obj.callback);
            }
          });
        } else {
          adapter.sendTo(obj.from, obj.command, gardenaCloudConnector.get_auth(), obj.callback);
        }
        wait = true;
        break;
      case 'retrieveLocations':
        msg = obj.message;

        gardenaCloudConnector.retrieveLocations(msg.token, msg.user_id, function (err, locations) {
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

        gardenaCloudConnector.retrieveDevicesFromLocation(msg.token, msg.location_id, function (err, devices) {
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
  adapter.log.info('Starting gardena smart system adapter');

  gardenaDBConnector.setAdapter(adapter);  // set adapter instance in the DBConnector
  gardenaCloudConnector.setAdapter(adapter);  // set adapter instance in the DBConnector

  syncConfig();  // sync database with config

  // connect to gardena smart system service and start polling
  gardenaCloudConnector.connect(function(err, auth_data) {
    if(err) {
      adapter.log.error(err);
    }
  });

  // gardena subscribes to all state changes
  adapter.subscribeStates('datapoints.*.trigger');
  adapter.subscribeStates('datapoints.*.smart_trigger');
  adapter.subscribeStates('info.connection');
}

// a command was triggered
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
        gardenaCloudConnector.sendCommand(id, cmd, deviceid, locationid, function(err) {
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

// a smart command was triggered
function triggeredSmartEvent(id, state, callback) {
  let locationid = id.split('.')[3];
  let deviceid = id.split('.')[4];

  // get the name of the trigger state (this is equal to the command)
  adapter.getObject(id, function(err, obj) {
    let cmd = obj.common.name;

    // get property states
    adapter.getStates(id.split('.').slice(0, -1).join('.') + '.properties.*', function(err, states) {
      // build the json for the http put command
      let json = {
        "properties": {
          "name": cmd,
          "values": undefined
        }
      }

    });
  });
}

// synchronize config
function syncConfig() {

  // compare gardena datapoints with objects, anything changed?
  // create locations inside the datapoints structure
  gardenaDBConnector.syncDBDatapoints();
}
