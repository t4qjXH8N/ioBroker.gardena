"use strict";

let adapter;

exports.setAdapter = function(adapter_in) {
  adapter = adapter_in;
};


function createDBLocationState(id, state, val) {
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
                createDBLocationState('gardena.' + adapter.instance + '.locations.' + curlocation['id'] + '.' + cstate, cstate, curlocation[cstate].join(','));
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
                  createDBLocationState('gardena.' + adapter.instance + '.locations.' + curlocation['id'] + '.' + cstate + '.' + citem, citem, curlocation[cstate][citem]);
                }
              } else {
                // simple state
                createDBLocationState('gardena.' + adapter.instance + '.locations.' + curlocation['id'] + '.' + cstate, cstate, curlocation[cstate]);
              }
            }
          }
        });
      });
    }
  }

  if (callback) callback(false);
};
