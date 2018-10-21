![Logo](admin/gardena.png)
ioBroker gardena adapter
=================
[![NPM version](http://img.shields.io/npm/v/iobroker.gardena.svg)](https://www.npmjs.com/package/iobroker.gardena)
[![Downloads](https://img.shields.io/npm/dm/iobroker.gardena.svg)](https://www.npmjs.com/package/iobroker.gardena)

[![NPM](https://nodei.co/npm/iobroker.gardena.png?downloads=true)](https://nodei.co/npm/iobroker.gardena/)

This is an [ioBroker](https://github.com/ioBroker/ioBroker) Adapter supporting the Gardena Smart System web service.  

## Description

This adapter connects to the Gardena Smart System web services. From this web service data from all devices  is retrieved and stored in ioBroker states. These states are updated in a given interval, hence the states should be up to date. At the moment it can retrieve data from all gardena devices, but only some devices can be controlled.

Gardena devices can be controlled by setting the value of so called _command states_ to true. This triggers an event and a command is send to the Gardena Smart System service.

Please note that only a few devices can be controlled at the moment. If you want to add commands to control a device, please follow the steps below. Here, we assume that a mobile running Android is used for this. 

1. Install the [GARDENA Smart System App](https://play.google.com/store/apps/details?id=com.gardena.smartgarden&hl=en) on the android phone, if not yet installed.
2. Install an app for sniffing the traffic between the app and the web service on your phone. I like [Packet Capture](https://play.google.com/store/apps/details?id=app.greyshirts.sslcapture&hl=en).
3. Activate the sniffer and send a command to the device using the GARDENA Smart System app.
4. Send me the retrieved JSON via [Email](mailto:chvorholt@gmail.com) or, even better, add the commands to [gardena_commands.json](/lib/gardena_commands.json) for yourself and open a pull request. For example, a JSON send by the Gardena app may look like this:

```json
PUT /sg-1/devices/[deviceID]/abilities/outlet/command?locationId=[locationID] HTTP/1.1

{"name":"manual_override","parameters":{"manual_override":"open","duration":2}}HTTP/1.1 204 No Content
Date: Mon, 1 Jul 2018 01:55:22 GMT
Connection: keep-alive
X-Rate-Limit-Limit: 6300
X-Rate-Limit-Remaining: 6296
X-Rate-Limit-Reset: 2

PUT /sg-1/devices/[deviceID]/abilities/outlet/properties/button_manual_override_time?locationId=[locationID] HTTP/1.1

{"properties":{"name":"button_manual_override_time","value":2,"timestamp":"2018-07-1T04:33:09.122Z","at_bound":null,"unit":"minutes","writeable":true,"supported_values":[],"ability":"[abilityID]"}}HTTP/1.1 204 No Content
Date: Mon, 1 Jul 2018 01:55:24 GMT
Connection: keep-alive
X-Rate-Limit-Limit: 6300
X-Rate-Limit-Remaining: 6296
X-Rate-Limit-Reset: 1)
```

## Installation
Just install the adapter in the iobroker admin interface or fetch it from Github.

## Changelog
# 1.2.0 (05-Aug-2018)
- support for Gardena [smart irrigation control](https://www.gardena.com/int/products/smart/smart-system/pim94995109/967669901/)

# 1.1.0 (23-Jul-2019)
- new devices can be added more easily 

# 1.0.1 (17-Jul-2018)
- readded travis/appveyor testing

# 1.0.0 (17-Jul-2018)
- added support for Admin3

# 0.1.1 (15-Jul-2018)
- minimum polling time is 60 seconds

# 0.1.0 (22-Apr-2018)
- commands can be parametrized by designated states

# 0.0.3 (08-Apr-2018)
- bugfix: state was updated only once

## Disclaimer
I am not in any association with Gardena or Husqvarna.

## License
The MIT License (MIT)

Copyright (c) 2017-2018 Christian Vorholt <chvorholt@mail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
