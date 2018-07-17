![Logo](admin/gardena.png)
# ioBroker.gardena
=================

This is an [ioBroker](https://github.com/ioBroker/ioBroker) Adapter supporting the Gardena Smart System.

## Description

This adapter connects to the Gardena Smart System webservices. From this webservice a all device data is retrieved and stored in ioBroker states. These states are updated in a given interval, hence the states should be up to date.

Commands can be send by setting the value of command states to true. This triggers an event and a command is sent to the Gardena Smart System.

Please note that this is an alpha version and at the moment only commands of the mower are supported, since I do not have the possibility to test other equipment.

## Installation
Just install the adapter in the iobroker admin interface.

## Changelog
# 1.0.1 (17-07-2018)
Readded travis/appveyor testing.

# 1.0.0 (17-07-2018)
Added support for Admin3.

# 0.1.1 (15-07-2018)
Minimum polling time is 60 seconds.

# 0.1.0 (22-04-2018)
Commands can be parametrized by designated states.

# 0.0.3 (08-04-2018)
Bugfix: state was updated only once.

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
