"use strict";

let adapter;
const jsonPath = require('jsonpath');

let dp_prefix;  // prefix for datapoints in the objects DB
let loc_prefix;  // prefix for locations in the objects DB
const conf_seperator = '___'; // separator to evaluate datapoints from the config
let conf_re_seperator = new RegExp(conf_seperator, 'g');

exports.setAdapter = function(adapter_in) {
  adapter = adapter_in;
  dp_prefix = 'gardena.' + adapter.instance + '.datapoints.';
  loc_prefix = 'gardena.' + adapter.instance + '.locations.';
};

// getter
exports.getdp_prefix = function() {
  return dp_prefix;
};

exports.getloc_prefix = function() {
  return loc_prefix;
};

exports.getconf_seperator = function() {
  return conf_seperator;
};

exports.getconf_re_seperator = function() {
  return conf_re_seperator;
};

// create location's datapoints in the DB
function createLocationStateInDB(id, state, val) {
  let crole = 'state';
  let ctype = typeof(val);

  switch(state) {
    case 'authorized_at':
      crole = 'date';
      break;
    case 'street':
      crole = 'location';
      break;
    case 'city':
      crole = 'location';
      break;
    case 'address':
      crole = 'location';
      break;
    case 'latitude':
      crole = 'value.gps.latitude';
      break;
    case 'longitude':
      crole = 'value.gps.longitude';
      break;
    case 'sunrise':
      crole = 'date.sunrise';
      break;
    case 'sunset':
      crole = 'date.sunset';
      break;
    default:
      switch(ctype) {
        case 'string':
          crole = 'text';
          break;
        case 'number':
          crole = 'value';
          break;
      }
  }

  let obj = {
    "_id": 'locations.' + id + '.' + state,
    "type": "state",
    "common": {
      "name": state,
      "read": true,
      "write": false,
      "type": ctype,
      "role": crole
    },
    "native": {}
  };

  adapter.setObjectNotExists(id, obj, function(err) {
    adapter.setState(id, val, true);
  });
}

// update locations in database
exports.updateDBLocations = function (jsondata, callback) {
  // update locations in the database
  for(let ckey in jsondata) {
    if (!(jsondata.hasOwnProperty(ckey) && ckey === 'locations')) break;

    let locations = jsondata[ckey];

    // go through all locations
    for(let i=0;i<locations.length;i++) {
      let curlocation = locations[i];

      // retrieve location id
      if(!curlocation.hasOwnProperty('id') || !curlocation['id'] || !curlocation.hasOwnProperty('name')) break; // valid location id?

      // create location state
      let obj = {
        "_id": 'locations.' + curlocation['id'],
        "type": "group",
        "common": {
          "name": curlocation['name']
        },
        "native": {}
      };
      adapter.setObjectNotExists(loc_prefix + curlocation['id'], obj, function(err) {
        // retrieve states from the DB for the current location
        adapter.getStates(loc_prefix + curlocation['id'] + '.*', function (err, states) {
          for(let cstate in curlocation) {
            if(states.hasOwnProperty(loc_prefix + curlocation['id'] + '.' + cstate)) {
              // states exists, set state value
            } else {
              // state does not exists, create it
              if(Array.isArray(curlocation[cstate])) {
                createLocationStateInDB(loc_prefix + curlocation['id'] + '.' + cstate, cstate, curlocation[cstate].join(','));
              } else if(typeof curlocation[cstate] === 'object' && curlocation[cstate]) {
                // create top group for the array
                let obj = {
                  "_id": loc_prefix + curlocation['id'] + '.' + cstate,
                  "type": "group",
                  "common": {
                    "name": cstate
                  },
                  "native": {}
                };
                adapter.setObjectNotExists(loc_prefix + curlocation['id'] + '.' + cstate, obj);

                // go through the array
                for(let citem in curlocation[cstate]) {
                  createLocationStateInDB(loc_prefix + curlocation['id'] + '.' + cstate + '.' + citem, citem, curlocation[cstate][citem]);
                }
              } else {
                // simple state
                createLocationStateInDB(loc_prefix + curlocation['id'] + '.' + cstate, cstate, curlocation[cstate]);
              }
            }
          }
        });
      });
    }
  }

  if (callback) callback(false);
};

// create a state for a datapoint in the DB
function createDatapointsStateInDB(id, state, cloud_data, callback) {
  let obj = {
    "_id": id,
    "type": "state",
    "common": {
      "name": state.name,
      "read": true,
      "write": false,
      "type": state.type,
      "role": state.role
    },
    "native": {}
  };

  for(let i=0;i<id.split('.').slice(5, -1).length;i++) {
    let cid = id.split('.').slice(5, -1)[i];

    let grp = {
      "_id": id.split('.').slice(0, 5 + i + 1).join('.'),
      "type": "group",
      "common": {},
      "native": {}
    };

    // can we find the id?
    let res = jsonPath.query(cloud_data, '$..[?(@.id=="' + cid + '")]');

    if(res.length === 0) {
      grp.common['name'] = cid;
    } else {
      grp.common['name'] = res[0].name;
    }

    adapter.setObjectNotExists(grp._id, grp, function(err) {
      if(callback) callback(err);
    });
  }

  adapter.setObjectNotExists(id, obj, function(err) {
    if(callback) callback(err);
  });
}

function createSmartDatapointsStateInDB(curid, state, cloud_data, callback) {
  let id = curid.split('.')[curid.split('.').length-1];
  let stateid = curid.replace('.' + id, '') + '.' + id;

  // go through the id list
  for(let i=0;i<stateid.split('.').slice(5).length;i++) {
    let cid = stateid.split('.').slice(5)[i];

    // can we find the id?
    let res = jsonPath.query(cloud_data, '$..[?(@.id=="' + cid + '")]');

    let grp = {
      "_id": stateid.split('.').slice(0, 5 + i + 1).join('.'),
      "type": "group",
      "common": {},
      "native": {}
    };
    if(res.length === 0) {
      grp.common['name'] = cid;
    } else {
      grp.common['name'] = res[0].name;
    }

    adapter.setObjectNotExists(stateid.split('.').slice(0, 5 + i + 1).join('.'), grp, function(err) {
      if (callback) callback(err);
    });
  }

  // query the last data from the cloud to get the names for the groups

  // complex datapoint?
  if(state.hasOwnProperty('unit') && state.unit === 'complex' && state.hasOwnProperty('value') && typeof(state.value) === 'object') {
    // oh a complex value setup a sub group called properties
    let sub_obj = {
      "_id": stateid + '.smart_trigger',
      "type": "state",
      "common": {
        "name": state.name,
        "desc": "Send command with properties",
        "type": "boolean",
        "read": true,
        "write": true,
        "def": false
      },
      "native": {}
    };

    adapter.setObjectNotExists(stateid + '.smart_trigger', sub_obj, function(err) {
      if (callback) callback(err);
    });

    let sub_grp = {
      "_id": stateid + '.properties',
      "type": "group",
      "common": {
        "name": 'properties'
      },
      "native": {}
    };

    adapter.setObjectNotExists(stateid + '.properties', sub_grp, function(err) {
      if(err) {
        if(callback) callback(err);
      } else {
        // now we can create states for the properties
        for(let celem in state.value) {
          let sub_sub_obj = {
            "_id": stateid + '.properties.' + celem,
            "type": "state",
            "common": {
              "name": celem,
              "desc": celem,
              "read": true,
              "type": typeof(state.value[celem]),
              "write": true
            },
            "native": {}
          };
          adapter.setObjectNotExists(stateid + '.properties.' + celem, sub_sub_obj, function(err) {
            if (err) {
              if (callback) callback(err);
            }
          });
        }
      }
    });
  } else {
    // no complex value with properties
    let obj = {
      "_id": stateid,
      "type": "state",
      "native": {}
    };

    let common = {
      "name": state.name,
      "desc": "Smart Datapoint",
      "read": true,
    };

    if (state.hasOwnProperty('writeable')) {
      common["writeable"] = state.writeable;
    }
    if (state.hasOwnProperty('type')) {
      common["type"] = state.type;
    }
    if (state.hasOwnProperty('role')) {
      common["role"] = state.role;
    }
    if (state.hasOwnProperty('unit')) {
      common["unit"] = state.unit;
    }

    obj['common'] = common;

    adapter.setObjectNotExists(stateid, obj, function (err) {
      if (callback) callback(err);
    });
  }
}

// create devices states under datapoints
function createLocationStatesInDBDatapoints(locations, names, callback) {
  let states_todo = locations.length;
  let states_done = 0;

  if(!locations || locations.length === 0) callback(false);

  for(let i=0;i<locations.length;i++) {
    let obj = {
      "_id": dp_prefix + locations[i],
      "type": "group",
      "common": {
        "name": names[i]
      },
      "native": {}
    };

    adapter.setObjectNotExists(dp_prefix + locations[i], obj, function(err) {
      states_done += 1;

      if(states_done === states_todo) {
        callback(false);
      }
    });
  }
}

// create devices states under datapoints.[location].device
function createDeviceStatesInDBDatapoints(devices, names, callback) {
  let states_todo = devices.length;
  let states_done = 0;

  if(!devices || devices.length === 0) callback(false);

  for(let i=0;i<devices.length;i++) {
    let obj = {
      "_id": dp_prefix + devices[i],
      "type": "device",
      "common": {
        "name": names[i]
      },
      "native": {}
    };

    adapter.setObjectNotExists(dp_prefix + devices[i], obj, function(err) {
      states_done += 1;

      if(states_done === states_todo) {
        callback(false);
      }
    });
  }
}

// this function is used for syncing datapoints in the DB with the ones from the config
exports.syncDBDatapoints = function (cloud_data, callback) {
  let config_states = adapter.config.gardena_datapoints;
  let smart_datapoints = adapter.config.gardena_smart_datapoints;

  let locations = [];
  let names = [];
  for(let cstate in config_states) {
    if(!locations.includes(cstate.split(conf_seperator)[0])) {
      locations.push(cstate.split(conf_seperator)[0]);
      names.push(config_states[cstate].location);
    }
  }
  // collect distinct locations
  createLocationStatesInDBDatapoints(locations, names, function(err) {
    // collect distinct device states
    let devices = [];
    names = [];
    for(let cstate in config_states) {
      if(!devices.includes(cstate.split(conf_seperator)[0] + '.' + cstate.split(conf_seperator)[1])) {
        devices.push(cstate.split(conf_seperator)[0] + '.' + cstate.split(conf_seperator)[1]);
        names.push(config_states[cstate].device.name);
      }
    }

    // create device states in DB
    createDeviceStatesInDBDatapoints(devices, names, function(err) {
      if(err) {
        adapter.log.error(err);
        return
      }

      // after creation, get all states already present in the db
      adapter.getStates('gardena.' + adapter.instance + '.datapoints.*', function (err, states) {
        // add datapoints if needed
        for(let cstate in config_states) {
          // check if we have a smart datapoint here
          if(config_states[cstate].hasOwnProperty('smart') && config_states[cstate].smart && smart_datapoints) {

            let smart_in_db = false;
            // check if the datapoint is already there
            for(let cstateindb in states) {
              if(cstateindb.includes(cstate.replace(conf_re_seperator, '.'))) {
                smart_in_db = true;
                break;
              }
            }

            if(!smart_in_db) {
              // create SMART datapoint
              createSmartDatapointsStateInDB(dp_prefix + cstate.replace(conf_re_seperator, '.'), config_states[cstate], cloud_data);
            }
          } else {
            // simply check if the dp is there
            if(!states.hasOwnProperty(dp_prefix + cstate.replace(conf_re_seperator, '.'))) {
              // state has to be created
              createDatapointsStateInDB(dp_prefix + cstate.replace(conf_re_seperator, '.'), config_states[cstate], cloud_data);
            }
          }
        }

        // remove datapoints if they are not in the config
        for(let cdp in states) {
          // check if the state belongs to a smart one
          let found = false;
          for(let cconf in config_states) {
            if(cdp.includes(cconf.replace(conf_re_seperator, '.'))) {
              found = true;
              break;
            }
          }

          if(!found) {
            // datapoint has to be removed
            let cdpex = cdp.replace(dp_prefix, '').replace(/\./g, conf_seperator);
            adapter.delObject(dp_prefix + cdpex.replace(conf_re_seperator, '.'));
          }
        }
      });
    });
  });
};

// update a single datapoint by traversing through the devices structure
function updateSingleDBDatapoint(curid, locationid, devices) {
  // setup a query
  if(curid.split(conf_seperator).length <= 1) {
    adapter.log.error('There is invalid id ' + curid + ' in the config!');
    return;
  }

  let prop = curid.split(conf_seperator)[curid.split(conf_seperator).length-1];
  let id = curid.split(conf_seperator)[curid.split(conf_seperator).length-2];
  let data = {"data": {"devices": devices}};

  let query = '$..[?(@.id=="' + id + '")]';
  let res = jsonPath.query(data, query);

  // try to find key in devices structure
  if(!res || !Array.isArray(res) || !res.length > 0 || !res[0].hasOwnProperty(prop)) {
    // we have a small datapoint
    let sub_query = '$..[?(@.id=="' + prop + '")]';
    let sub_res = jsonPath.query(data, sub_query);

    if(Array.isArray(sub_res) && sub_res.length > 0 && sub_res[0].hasOwnProperty('value') && typeof(sub_res[0].value) === 'object') {
      // update properties of smart datapoint
      for(let celem in sub_res[0].value) {
        adapter.setState(dp_prefix + locationid + '.' + curid.replace(conf_re_seperator, '.') + '.properties.' + celem, sub_res[0].value[celem]);
      }
    } else {
      adapter.log.warn('Warning, state ' + curid +  ' is present in the database but missing in the datagram from Gardena cloud.');
    }
  } else {
    // fine, set the value
    adapter.setState(dp_prefix + locationid + '.' + curid.replace(conf_re_seperator, '.'), res[0][prop]);
  }
}

// update specific gardena datapoints
exports.updateDBDatapoints = function (locationid, devices, callback) {
  let settings_dp = adapter.config.gardena_datapoints;

  // go through all states from the settings and update their value
  for(let cdp in settings_dp) {
    let cdpx = cdp.slice(cdp.indexOf(conf_seperator) + conf_seperator.length);

    updateSingleDBDatapoint(cdpx, locationid, devices.devices);
  }
  if (callback) callback(false);
};

// create set commands for devices in the database
function createSetCommands(cdev, callback) {

  // get all device and check
  getForeignObject()


  return;
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

