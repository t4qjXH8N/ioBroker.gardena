/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

// you have to require the utils module and call adapter function
const utils = require('@iobroker/adapter-core'); // Get common adapter utils
const jsonPath = require('jsonpath');

const trigger_poll_state = 'trigger_poll';  // state for triggering a poll

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.gardena.0
let adapter;
function startAdapter(options) {
  options = options || {};
  Object.assign(options, {
    name: "gardena",
    install: adapter_install,
    unload: adapter_unload,
    objectChange: adapter_objectChange,
    stateChange: adapter_stateChange,
    ready: adapter_ready,
    message: adapter_message
  });
  adapter = new utils.Adapter(options);

  return adapter;
}

const gardenaCloudConnector = require(__dirname + '/lib/gardenaCloudConnector');
const gardenaDBConnector = require(__dirname + '/lib/gardenaDBConnector');

// triggered when the adapter is installed
const adapter_install = function () {};

// is called when the adapter shuts down - callback has to be called under any circumstances!
const adapter_unload = function (callback) {
  try {
    adapter.log.info('cleaned everything up...');
      callback();
  } catch (e) {
      callback();
  }
};

// is called if a subscribed object changes
const adapter_objectChange = function (id, obj) {
  // Warning, obj can be null if it was deleted
  adapter.log.debug('objectChange ' + id + ' ' + JSON.stringify(obj));
};

// is called if a subscribed state changes
const adapter_stateChange = function (id, state) {
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
  // a poll was manually triggered
  if(id && state && id === 'gardena.' + adapter.instance + '.' + trigger_poll_state && state.val === true) {
    gardenaCloudConnector.poll(function (err) {
      adapter.setState(trigger_poll_state, false, false); // reset trigger state
      adapter.log.debug('A poll was triggered manually.');
    });
  }

  // you can use the ack flag to detect if it is status (true) or command (false)
  if (state && state.val && !state.ack && id.split('.')[id.split('.').length-1] === 'trigger') {
    triggeredEvent(id, function (err) {
      if(err) adapter.log.error('An error occurred during trigger!');
      // reset trigger
      adapter.setState(id, false);
    });
  }

  if (state && state.val && !state.ack && id.split('.')[id.split('.').length-1] === 'smart_trigger') {
    triggeredSmartEvent(id, function (err) {
      if(err) adapter.log.error('An error occurred during smart trigger!');
      // reset trigger
      adapter.setState(id, false);
    });
  }
};

// is called when databases are connected and adapter received configuration.
const adapter_ready = function () {
  // start main function
  main();
};

// messages
const adapter_message = function (obj) {
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
};

// main function
function main() {
  adapter.log.info('Starting gardena smart system adapter');

  gardenaDBConnector.setAdapter(adapter);  // set adapter instance in the DBConnector
  gardenaCloudConnector.setAdapter(adapter);  // set adapter instance in the DBConnector

  // connect to gardena smart system service and start polling
  // we need a connection for syncing the states
  gardenaCloudConnector.connect(null, null, function(err, auth_data) {
    if(err) {
      adapter.log.error(err);
    } else {
      gardenaCloudConnector.poll(function (err) {
        syncConfig(gardenaCloudConnector.get_cloud_data());  // sync database with config
      });
    }
  });

  // gardena subscribes to all state changes
  adapter.subscribeStates('datapoints.*.trigger');
  adapter.subscribeStates('datapoints.*.smart_trigger');
  adapter.subscribeStates('info.connection');
  adapter.subscribeStates(trigger_poll_state)
}

// a command was triggered
function triggeredEvent(id, callback) {
  let locationid = id.split('.').slice(3, 4);
  let deviceid = id.split('.')[4];

  // get the name of the trigger state (this is equal to the command)
  adapter.getObject(id, function(err, obj) {
    let cmd = obj.common.name;

    // collect parameters
    // get property states
    adapter.getStates(id.split('.').slice(0, -1).join('.') + '.parameters.*', function(err, states) {
      // build the json for the http put command
      let json = {
        "name": cmd,
        "parameters": {}
      };

      for(let cstate in states) {
        json.parameters[cstate.split('.').slice(-1)[0]] = states[cstate].val;
      }

      let names = getNamesFromIDs(id.split('.'));

      let gardena_conf = gardenaCloudConnector.get_gardena_config();
      let uri = gardena_conf.baseURI + gardena_conf.devicesURI + '/' + deviceid + '/' + names.slice(5, -2).join('/');
      uri = uri + '?locationId=' + locationid;

      gardenaCloudConnector.http_post(uri, json, function(err) {
        if(callback) callback(err);
      });
    });

  });
}

// a smart command was triggered
function triggeredSmartEvent(id, callback) {
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
          "value": {}
        }
      };

      for(let cstate in states) {
        json.properties.value[cstate.split('.').slice(-1)[0]] = states[cstate].val;
      }

      let names = getNamesFromIDs(id.split('.'));

      let gardena_conf = gardenaCloudConnector.get_gardena_config();
      let uri = gardena_conf.baseURI + gardena_conf.devicesURI + '/' + deviceid + '/' + names.slice(5, -2).join('/') + '/properties/' + names.slice(-2, -1);
      uri = uri + '?locationId=' + locationid;

      gardenaCloudConnector.http_put(uri, json, function(err) {
        if(callback) callback(err);
      });
    });
  });
}

// synchronize config
function syncConfig(cloud_data) {

  // compare gardena datapoints with objects, anything changed?
  // create locations inside the datapoints structure
  gardenaDBConnector.syncDBDatapoints(cloud_data, function(err) {
    // do we have to create commands for devices?
    gardenaDBConnector.createHTTPPostDatapointsinDB(cloud_data);
  });
}

// this helper function returns the names from an array of ids
function getNamesFromIDs(ids) {
  let cloud_data = gardenaCloudConnector.get_cloud_data();

  let names = [];
  for(let i=0;i<ids.length;i++) {

    // can we find the id?
    let res = jsonPath.query(cloud_data, '$..[?(@.id=="' + ids[i] + '")]');

    if(!res || !Array.isArray(res) || res.length === 0) {
      names.push(ids[i]);
    } else {
      names.push(res[0].name);
    }
  }

  return names;
}

// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
  module.exports = startAdapter;
} else {
  // or start the instance directly
  startAdapter();
}
