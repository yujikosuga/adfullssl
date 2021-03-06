// Copyright 2014 LinkedIn Corp. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

/**
 * This script defines a browser, which views a url and logs the all the network traffic
 * including the requests made by the urls. Any accesses to private network is blocked
 * automatically.
 */

var fs = require('fs'),
    webpage = require('webpage'),
    system = require('system');

var browser = {};

(function(browser) {

  /**
   * Merge objects. Elements in the `dst` object will be overridden
   * if the same field exists in the `src` object.
   *
   * @param {Object} dst The destination object.
   * @param {Object} src The source object.
   */
  Object.extend = function(dst, src) {
    for (var prop in src) {
      dst[prop] = src[prop];
    }
    return dst;
  };

  /**
   * Timeout to exit the browser after making no requests.
   */
  var IDLE_TIMEOUT = 5000;

  /**
   * Timeout to end the connection to a request.
   */
  var REQUEST_TIMEOUT = 3000;

  var exitTimeoutHandle = null;

  var options = {
    useCookie: true,
    url: null,
    logFile: null,
    javascriptEnabled: true,
    hostedLocally: true,
    cookieDir: null,
    debug: false,
    ipLookupUrl: null
  };

  var pageResources = null;

 /**
  * Call the callback function after the idle timeout.
  *
  * @param {Function} callback The function to be called after the idle timeout.
  */
  var resetExitTimeoutHandle = function(callback, timeout) {

    clearTimeout(exitTimeoutHandle);

    var timeoutStartDate = new Date();
    var _timeout = timeout != null ? timeout : IDLE_TIMEOUT;

    exitTimeoutHandle = setTimeout(function() {
      var remainingTime = _timeout - (new Date().getTime() - timeoutStartDate.getTime());
      if(remainingTime > 0 ) {
        resetExitTimeoutHandle(callback, remainingTime);
      } else if(callback) {
        setTimeout(callback, 0);
      } else {
        exit();
      }
    }, _timeout);
  };

  /**
   * Return true if the `ip` is an IP address in a private network.
   *
   * @param {String} ip The string that represents an IP address.
   * @return {boolean} true if the `ip` represents an IP address in a private network.
   */
  var isPrivateIp = function(ip) {
    return /^(127\.0\.0\.1|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|10\.)/.test(ip);
  };

  /**
   * Return true if the `url` is a location inside of a private network.
   *
   * @param {String} url The url.
   * @return {boolean} true if the `url` represents a location inside of a private network.
   */
  var isPrivateNetwork = function(url) {
    var ip = undefined;

    if(url && !/^(data:|blob:)/.test(url) && options.ipLookupUrl) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', options.ipLookupUrl + '?url=' + encodeURIComponent(url), false);
      xhr.onreadystatechange = function() {
        if (xhr.readyState == 4 && xhr.status == 200) {
          try {
            var json = JSON.parse(xhr.responseText);
            ip = json.ip;
          } catch(err) {}
        }
      };
      xhr.send(null);
    }
    return ip && isPrivateIp(ip);
  };

  /**
   * Initialize the page load.
   *
   * @param {Object} page An instance of PhantomJS's WebPage object.
   * @param {Function} callback The function to be called after the idle timeout.
   */
  var initPage = function(page, callback) {
    if(!page.resources) {
      page.resources = {};
    }
    page.settings.webSecurityEnabled = false;
    page.settings.javascriptEnabled = options.javascriptEnabled;
    page.settings.resourceTimeout = REQUEST_TIMEOUT;

    page.onResourceRequested = function(requestData, networkRequest) {
      resetExitTimeoutHandle(callback);
      page.resources[requestData.url] = {
        request: requestData,
        response: null,
        error: null
      };

      // Abort requests to private network if ads are not hosted locally
      // or ads are hosted locally but requests are made to inside of a private network.
      if(!options.debug && (!options.hostedLocally || Object.keys(page.resources).length > 1) && isPrivateNetwork(requestData.url)) {
        page.resources[requestData.url].error = {
          id: requestData.id,
          url: requestData.url,
          errorCode: 999,
          errorString: 'Access to private network'
        };
        networkRequest.abort();
      }
    };

    page.onResourceReceived = function(response) {
      resetExitTimeoutHandle(callback);
      if(response.stage === 'end' && page.resources[response.url]) {
        page.resources[response.url].response = response;
      }
    };

    page.onResourceError = function(resourceError) {
      resetExitTimeoutHandle(callback);
     if(page.resources[resourceError.url] && !page.resources[resourceError.url].error) {
        page.resources[resourceError.url].error = resourceError;
      }
    };
  };

  /**
   * Quit this process. The network and error logs are saved in a JSON format
   * in the log file.
   */
  var exit = function() {
    fs.write(options.logFile, JSON.stringify(pageResources), 'w');
    phantom.exit();
  };

  /**
   * Load cookies on the browser.
   */
  var setCookies = function() {
    if(!options.cookieDir || !fs.exists(options.cookieDir) || !fs.isDirectory(options.cookieDir)) {
      return;
    }

    var regiesterCookie = function(name, value, domain) {
      phantom.addCookie({
        name  : name,
        value : value,
        domain: domain
      });
    };

    fs.list(options.cookieDir).forEach(function(file) {
      if (file !== '.' && file !== '..') {
        var domain = file.substr(0, file.indexOf('.txt'));
        var content = fs.read(options.cookieDir + '/' + file);
        var cookies = content.split(';').map(function(a){
          var c = a.trim();
          var i = c.indexOf('=');
          regiesterCookie(c.substr(0, i), c.substr(i + 1), domain);
        });
      }
    });
  };

  /**
   * Start the browser.
   *
   * @param {Object} opts The object to override the `options`, which
   *   defines the default settings of this browser.
   */
  var run = function(opts) {
    options = Object.extend(options, opts);

    if(options.useCookie) {
      phantom.cookiesEnabled = true;
      setCookies();
    }

    if(options.url) {
      var page = webpage.create();
      initPage(page, exit);
      page.open(options.url);
      pageResources = page.resources;
    } else {
      exit();
    }
  };

  browser.run = run;

})(browser);

var options = {};
var argIndex = 1;

/**
 * Parse the command line arguments
 *
 * @param {boolean} --use-cookie Enable/disable the use of cookies on the browser.
 * @param {boolean} --enable-javascript Enable/disable JavaScript on the browser.
 * @param {boolean} --hosted-locally A boolean value if the ads are hosted on the local server.
 * @param {String} --log-file The location of log file.
 * @param {String} --url The URL to be scanned.
 * @param {String} --cookie-dir The directory where cookies are defined.
 * @param {String} --debug Turn on the debug mode, which allows access to private network.
 * @param {String} --iplookup-url Url for iplookup service.
 */
 while(argIndex < system.args.length && system.args[argIndex].indexOf("--") === 0){
  var option = system.args[argIndex].substring(2);
  switch(option) {
  case "use-cookie":
    argIndex++;
    options.useCookie = system.args[argIndex].trim() != 'false';
    break;
  case "enable-javascript":
    argIndex++;
    options.javascriptEnabled = system.args[argIndex].trim() != 'false';
    break;
  case "hosted-locally":
    argIndex++;
    options.hostedLocally = system.args[argIndex].trim() != 'false';
    break;
  case "log-file":
    argIndex++;
    options.logFile = system.args[argIndex].replace(/^\"|\"$/g, '').replace(/^\'|\'$/g, '').trim();
    break;
  case "url":
    argIndex++;
    options.url = system.args[argIndex].replace(/^\"|\"$/g, '').replace(/^\'|\'$/g, '').trim();
    break;
  case "cookie-dir":
    argIndex++;
    options.cookie_dir = system.args[argIndex].replace(/^\"|\"$/g, '').replace(/^\'|\'$/g, '').trim();
    break;
  case "debug":
    argIndex++;
    options.debug = system.args[argIndex].trim() == 'true';
    break;
  case "iplookup-url":
    argIndex++;
    options.ipLookupUrl = system.args[argIndex].replace(/^\"|\"$/g, '').replace(/^\'|\'$/g, '').trim();
    break;
  }
  argIndex++;
}
browser.run(options);
