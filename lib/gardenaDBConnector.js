"use strict";

let adapter;
const jsonPath = require('jsonpath');

const gardena_commands = require(__dirname + '/gardena_commands.json');  // gardena commands

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
        "type": "",
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
                  "type": "",
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
      "type": "",
      "common": {},
      "native": {}
    };

    // can we find the id?
    let res = jsonPath.query(cloud_data, '$..[?(@.id=="' + cid + '")]');

    if(res && Array.isArray(res) && res.length === 0) {
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

// create a smart datapoint in the DB
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
      "type": "",
      "common": {},
      "native": {}
    };
    if(res && Array.isArray(res) && res.length === 0) {
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
        "role": "switch",
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
      "type": "",
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

          let type = typeof(state.value[celem]);
          let role = 'state';

          switch(type) {
            case 'string':
              role = 'text';
              break;
            case 'number':
              role = 'level';
              break;
            case 'boolean':
              role = 'switch';
              break;
          }

          let sub_sub_obj = {
            "_id": stateid + '.properties.' + celem,
            "type": "state",
            "common": {
              "name": celem,
              "desc": celem,
              "read": true,
              "type": type,
              "role": role,
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

    // get some more attributes
    let res = jsonPath.query(cloud_data, '$..[?(@.id=="' + stateid.split('.').slice(-1) + '")]');

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
      common["write"] = state.writeable;
    }
    if (state.hasOwnProperty('type')) {
      common["type"] = state.type;
    } else {
      // try to get the type from the value
      if(res && Array.isArray(res) && res.length > 0 && res[0].hasOwnProperty('value') && res[0].value) {
        common['type'] = typeof(res[0].value)
      }
    }

    if (state.hasOwnProperty('unit')) {
      common["unit"] = state.unit;
    }
    if (state.hasOwnProperty('role')) {
      common['role'] = state.role;
    }

    if((common.hasOwnProperty('role') && common['role'] === 'state') || !common.hasOwnProperty('role')) {
      // check if role is simply state
      // if it is so try a better guess

      if (common.hasOwnProperty('type') && common.type === 'string') {
        common['role'] = 'text';
      } else if (common.hasOwnProperty('type') && common.type === 'boolean' && common.hasOwnProperty('write') && common.write === true && common.hasOwnProperty('read') && common.read === false) {
        common['role'] = 'button';
      } else if(common.hasOwnProperty('type') && common.type === 'number' && common.hasOwnProperty('write') && common.write === false) {
        common['role'] = 'value';
      } else if (common.hasOwnProperty('type') && common.type === 'boolean' && common.hasOwnProperty('write') && common.write === false) {
        common['role'] = 'sensor';
      } else if (common.hasOwnProperty('type') && common.type === 'number' && common.hasOwnProperty('write') && common.write === true) {
        common['role'] = 'level';
      } else if (common.hasOwnProperty('type') && common.type === 'boolean' && common.hasOwnProperty('write') && common.write === true) {
        common['role'] = 'switch';
      }
    }

    if (res && Array.isArray(res) && res.length > 0 && res[0].hasOwnProperty('supported_values') && Array.isArray(res[0].supported_values) && res[0].supported_values.length > 0) {
      // we have some kind of enum here
      let enum_states = {};

      for(let i=0;i<res[0].supported_values.length;i++) {
        enum_states[i] = res[0].supported_values[i];
      }
      common["states"] = enum_states;
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
      "type": "",
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
        if(callback) callback(err);
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

        if(callback) callback(false);
      });
    });
  });
};

// updates a single datapoint by traversing through the devices structure
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

    if(sub_res && Array.isArray(sub_res) && sub_res.length > 0 && sub_res[0].hasOwnProperty('value') && typeof(sub_res[0].value) === 'object') {
      // update properties of smart datapoint
      for(let celem in sub_res[0].value) {
        adapter.setState(dp_prefix + locationid + '.' + curid.replace(conf_re_seperator, '.') + '.properties.' + celem, sub_res[0].value[celem]);
      }
    } else if(sub_res && Array.isArray(sub_res) && sub_res.length > 0 && sub_res[0].hasOwnProperty('value')) {
      adapter.setState(dp_prefix + locationid + '.' + curid.replace(conf_re_seperator, '.'), sub_res[0].value);
    } else {
      adapter.log.warn('Warning, state ' + curid +  ' is present in the database but missing in the datagram from Gardena cloud.');
    }
  } else {
    // fine, set the value
    adapter.setState(dp_prefix + locationid + '.' + curid.replace(conf_re_seperator, '.'), res[0][prop]);
  }
}

// update datapoints after polling
exports.updateDBDatapoints = function (locationid, devices, callback) {
  let settings_dp = adapter.config.gardena_datapoints;

  // go through all states from the settings and update their values
  for(let cdp in settings_dp) {
    let cdpx = cdp.slice(cdp.indexOf(conf_seperator) + conf_seperator.length);

    updateSingleDBDatapoint(cdpx, locationid, devices.devices);
  }
  if (callback) callback(false);
};

// create set commands for devices that support only post commands (these commands have to be supplied by gardena_commands.json)
exports.createHTTPPostDatapointsinDB = function(cloud_data, callback) {

  // get all categories in the gardena commands file
  let cat_commands = jsonPath.query(gardena_commands, '$..[?(@.category)]');

  // first get all devices in the DB and check their category
  adapter.getDevices(function(err, devices) {
    // get category of device
    for(let i=0;i<devices.length;i++) {
      let cdev_id = devices[i]._id.split('.').slice(-1)[0];  // get id of the device
      let device_cat = jsonPath.query(cloud_data, '$..datapoints..devices[?(@.id=="' + cdev_id + '")]');

      if(!device_cat || !Array.isArray(device_cat) || !device_cat.length > 0 || !device_cat[0].hasOwnProperty('category')) {
        adapter.log.debug('Could not find category for device ' + cdev_id);

        continue;
      }

      // is this category present in the gardena commands file?
      let in_commands = jsonPath.query(cat_commands, '$..[?(@.category=="' + device_cat[0].category + '")]');

      if(in_commands.length > 0) {
        // category present in file create the states
        createCommandStatesInDB(devices[i], device_cat[0].category);
      }
    }
  });
};

function createCommandStatesInDB(device, category, callback) {
  // get commands
  let cat_commands = jsonPath.query(gardena_commands, '$[?(@.category=="' + category + '")]')[0];

  let baseURI = cat_commands.baseURI;

  // setup object structure
  for(let i=0;i<baseURI.split('/').length;i++) {
    let grp = {
      "_id": device._id + '.' + baseURI.split('/').slice(0, i + 1).join('.'),
      "type": "",
      "common": {
        "name": baseURI.split('/')[i]
      },
      "native": {}
    };

    adapter.setObjectNotExists(grp._id, grp, function(err) {
      if(callback) callback(err);
    });
  }

  // setup the commands
  let commands_to_create = cat_commands.commands;

  for(let i=0;i<commands_to_create.length;i++) {
    // create subgroup for command

    let grp = {
      "_id": device._id + '.' + baseURI.split('/').join('.') + '.' + commands_to_create[i].name,
      "type": "",
      "common": {
        "name": commands_to_create[i].cmd_desc
      },
      "native": {}
    };

    adapter.setObjectNotExists(grp._id, grp, function(err) {
      if(!err) {
        // create trigger state
        let obj = {
          "_id": device._id + '.' + baseURI.split('/').join('.') + '.' + commands_to_create[i].name + '.' + 'trigger',
          "type": "state",
          "common": {
            "name": commands_to_create[i].name,
            "read": true,
            "write": false,
            "role": "switch",
            "type": "boolean",
            "def": false
          },
          "native": {}
        };
        adapter.setObjectNotExists(obj._id, obj, function(err) {});

        // are there parameters?
        if(commands_to_create[i].hasOwnProperty('parameters') && commands_to_create[i].parameters.length > 0 ) {
          // create parameter group

          let grp = {
            "_id": device._id + '.' + baseURI.split('/').join('.') + '.' + commands_to_create[i].name + '.parameters',
            "type": "",
            "common": {
              "name": "parameters"
            },
            "native": {}
          };

          adapter.setObjectNotExists(grp._id, grp, function(err) {
            // now create the parameters
            for(let j=0;j<commands_to_create[i].parameters.length;j++) {
              let cparam = commands_to_create[i].parameters[j];

              let desc = 'parameter for ' + commands_to_create[i].name;
              if(cparam.hasOwnProperty('desc')) desc = cparam.desc;

              let role = 'state';
              if(cparam.hasOwnProperty('role')) role = cparam.role;

              let write = true;
              if(cparam.hasOwnProperty('write')) write = cparam.write;

              let val;
              if(cparam.hasOwnProperty('val')) val = cparam.val;

              let obj = {
                "_id": device._id + '.' + baseURI.split('/').join('.') + '.' + commands_to_create[i].name + '.parameters.' + cparam.name,
                "type": "state",
                "common": {
                  "name": cparam.name,
                  "desc": desc,
                  "read": true,
                  "write": write,
                  "role": role,
                  "type": cparam.type,
                  "def": val
                },
                "native": {}
              };
              adapter.setObjectNotExists(obj._id, obj, function(err) {
                // set the value
                if(!err && val) adapter.setState(obj._id, val)
              });

            }
          });
        }
      }

      if(callback) callback(err);
    });
  }

  if(callback) callback(false);
}
