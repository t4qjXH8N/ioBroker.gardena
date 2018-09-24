"use strict";

let adapter;
const jsonPath = require('jsonpath');

let dp_prefix;  // prefix for datapoints in the objects DB
let loc_prefix;  // prefix for locations in the objects DB
const conf_seperator = '_'; // seperator to evaluate datapoints from the config
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
function createDatapointsStateInDB(id, state, callback) {
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

  adapter.setObjectNotExists(id, obj, function(err) {
    if(callback) callback(err);
  });
}

// create devices states under datapoints
function createLocationStatesInDBDatapoints(locations, names, callback) {
  let states_todo = locations.length;
  let states_done = 0;

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
exports.createDBDatapoints = function (datapoints, callback) {
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
          if(config_states[cstate].hasOwnProperty('smart') && config_states[cstate].smart) {

          } else {
            // simply check if the dp is there
            if(!states.hasOwnProperty(dp_prefix + cstate.replace(conf_re_seperator, '.'))) {
              // state has to be created
              createDatapointsStateInDB(dp_prefix + cstate.replace(conf_re_seperator, '.'), config_states[cstate]);
            }
          }
        }

        // remove datapoints if they are not in the config
        for(let cdp in states) {
          let cdpex = cdp.replace(dp_prefix, '').replace(/\./g, conf_seperator);
          if(!config_states.hasOwnProperty(cdpex)) {
            // datapoint has to be removed
            adapter.delObject(dp_prefix + cdpex.replace(conf_re_seperator, '.'));
          }
        }
      });
    });
  });
};

// update a single datapoint by traversing through th<e devies structure
function updateSingleDBDatapoint(curid, locationid, devices) {
  // setup a query
  if(curid.split(conf_seperator).length <= 1) {
    adapter.log.error('There is invalid id ' + curid + ' in the config!');
    return;
  }

  let prop = curid.split(conf_seperator)[curid.split(conf_seperator).length-1];
  let id = curid.split(conf_seperator)[curid.split(conf_seperator).length-2];
//  let query = 'devices[**][id=' + id + '].' + prop;

  let data = {"data": {"devices": devices}};
//  let res = jsonQuery(query, data);

  let query = '$..[?(@.id=="' + id + '")]';
  let res = jsonPath.query(data, query);

  // try to find key in devices structure
  if(!res || !Array.isArray(res) || !res.length > 0 || !res[0].hasOwnProperty(prop)) {
    adapter.log.warn('Warning, state ' + curid +  ' is present in the database but missing in the datagram from Gardena cloud.');
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
    let cdpx = cdp.slice(cdp.indexOf(conf_seperator) + 1);

    updateSingleDBDatapoint(cdpx, locationid, devices.devices);
  }
  if (callback) callback(false);
};

