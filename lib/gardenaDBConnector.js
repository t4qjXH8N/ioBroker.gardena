"use strict";

let adapter;

exports.setAdapter = function(adapter_in) {
  adapter = adapter_in;
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
      adapter.setObjectNotExists('gardena.' + adapter.instance + '.locations.' + curlocation['id'], obj, function(err) {
        // retrieve states from the DB for the current location
        adapter.getStates('gardena.' + adapter.instance + '.locations.' + curlocation['id'] + '.*', function (err, states) {
          for(let cstate in curlocation) {
            if(states.hasOwnProperty('adapter.' + adapter.instance + '.locations.' + curlocation['id'] + '.' + cstate)) {
              // states exists, set state value
            } else {
              // state does not exists, create it
              if(Array.isArray(curlocation[cstate])) {
                createLocationStateInDB('gardena.' + adapter.instance + '.locations.' + curlocation['id'] + '.' + cstate, cstate, curlocation[cstate].join(','));
              } else if(typeof curlocation[cstate] === 'object' && curlocation[cstate]) {
                // create top group for the array
                let obj = {
                  "_id": 'locations.' + curlocation['id'] + '.' + cstate,
                  "type": "group",
                  "common": {
                    "name": cstate
                  },
                  "native": {}
                };
                adapter.setObjectNotExists('gardena.' + adapter.instance + '.locations.' + curlocation['id'] + '.' + cstate, obj);

                // go through the array
                for(let citem in curlocation[cstate]) {
                  createLocationStateInDB('gardena.' + adapter.instance + '.locations.' + curlocation['id'] + '.' + cstate + '.' + citem, citem, curlocation[cstate][citem]);
                }
              } else {
                // simple state
                createLocationStateInDB('gardena.' + adapter.instance + '.locations.' + curlocation['id'] + '.' + cstate, cstate, curlocation[cstate]);
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
      "_id": 'gardena.' + adapter.instance + '.datapoints.' + locations[i],
      "type": "group",
      "common": {
        "name": names[i]
      },
      "native": {}
    };

    adapter.setObjectNotExists('gardena.' + adapter.instance + '.datapoints.' + locations[i], obj, function(err) {
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
      "_id": 'gardena.' + adapter.instance + '.datapoints.' + devices[i],
      "type": "device",
      "common": {
        "name": names[i]
      },
      "native": {}
    };

    adapter.setObjectNotExists('gardena.' + adapter.instance + '.datapoints.' + devices[i], obj, function(err) {
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
    if(!locations.includes(cstate.split('_')[0])) {
      locations.push(cstate.split('_')[0]);
      names.push(config_states[cstate].location);
    }
  }
  // collect distinct locations
  createLocationStatesInDBDatapoints(locations, names, function(err) {
    // collect distinct device states
    let devices = [];
    names = [];
    for(let cstate in config_states) {
      if(!devices.includes(cstate.split('_')[0] + '.' + cstate.split('_')[1])) {
        devices.push(cstate.split('_')[0] + '.' + cstate.split('_')[1]);
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
          if(smart_datapoints) {

          } else {
            // simply check if the dp is there
            if(!states.hasOwnProperty('gardena.' + adapter.instance + '.' + cstate.replace(/_/g, '.'))) {
              // state has to be created
              createDatapointsStateInDB('gardena.' + adapter.instance + '.datapoints.' + cstate.replace(/_/g, '.'), config_states[cstate]);
            }
          }
        }

        // remove datapoints if they are not in the config
        for(let cdp in states) {
          let cdpex = cdp.replace('gardena.' + adapter.instance + '.datapoints.', '').replace(/\./g, '_');
          if(!config_states.hasOwnProperty(cdpex)) {
            // datapoint has to be removed
            adapter.delObject('gardena.' + adapter.instance + '.' + cdpex);
          }
        }
      });
    });
  });
};

// update a single datapoint by traversing through the devies structure
function updateSingleDBDatapoint(curid, rootid, locationid, devices) {
  if(curid.split('_').length === 1) {
    adapter.setState('datapoints.' + locationid + '.' + rootid.replace(/_/g, '.'), devices[curid]);
    return
  }

  // try to find key in devices structure
  let found = false;
  for(let i=0;i<devices.length;i++) {
    if(devices[i].id === curid.split('_')[0]) {
      // found key
      found = true;
      let rootid_rest = curid.slice(curid.indexOf('_')+1); // get the rest of the rootid
      let devices_rest = devices[i];

      updateSingleDBDatapoint(rootid_rest, rootid, locationid, devices_rest);
      break;
    }
  }

  if(found === false) {
    adapter.log.warn('Warning, state ' + rootid +  ' is present in the database but missing in the datagram from Gardena cloud.');
  }
}

// update specific gardena datapoints
exports.updateDBDatapoints = function (locationid, devices, callback) {
  let settings_dp = adapter.config.gardena_datapoints;

  // go through all states from the settings and update their value
  for(let cdp in settings_dp) {
    let cdpx = cdp.slice(cdp.indexOf('_')+1);

    updateSingleDBDatapoint(cdpx, cdpx, locationid, devices.devices);
  }
  if (callback) callback(false);
};

