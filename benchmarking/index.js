/**
 * RUN TEST: node index.js
 */

var fs = require("fs");
var performance = require('perf_hooks').performance;
var Benchmark = require('benchmark');
var suite = new Benchmark.Suite;


// JsonPath streaming libs
var oboe = require('./oboe-node.js');
var JSONParser = require('@streamparser/json').JSONParser;
var JSONPath = require('jsonpath-plus').JSONPath;
var Piffero = require('../dist/index.js').Piffero;

var ensure200MbDataset = require('./dataset-200mb.js').ensure200MbDataset;

// config
var DATASET = ensure200MbDataset();
var JSON_FILE = DATASET.filePath;
var JSON_PATH = '[' + DATASET.endIdx + '].payload.issue.user.received_events_url';
var STREAMPARSER_PATH = ('$' + JSON_PATH).replace(/\[(\d+)\]/g, '.$1').replace(/^\.\./, '.');

// run test ...
suite.add('Piffero (stream)',{
    defer: true,
    fn: function(deferred) { 
      var result = Piffero.findByPath(fs.createReadStream(JSON_FILE), '$.' + JSON_PATH);
      result.on('data' ,()=>{});
      result.on('end', () =>{deferred.resolve();});
    }
}).add('Piffero (string)', {
    defer: true,
    fn: function (deferred) {
        Piffero.findAsString(function (result) {
            deferred.resolve();
        },  
        fs.createReadStream(JSON_FILE), 
        '$.' + JSON_PATH
    );
    }
}).add('Oboe', {
    defer: true,
    fn: function (deferred) {
        oboe(fs.createReadStream(JSON_FILE)).node('!'+ JSON_PATH, function (result) {
            this.abort();
            deferred.resolve();
        });
    }
}).add('@streamparser/json', {
    defer: true,
    fn: function (deferred) {
        var settled = false;
        var stream = fs.createReadStream(JSON_FILE);
        var parser = new JSONParser({ paths: [STREAMPARSER_PATH], keepStack: false });
        parser.onValue = function () {
            if (!settled) {
                settled = true;
                stream.destroy();
                deferred.resolve();
            }
        };
        stream.on('data', function (chunk) {
            if (!settled) parser.write(chunk);
        });
        stream.on('end', function () {
            if (!settled && !parser.isEnded) parser.end();
        });
    }
}).add('jsonpath-plus (in-memory)', {
    defer: true,
    fn: function (deferred) {
        fs.promises.readFile(JSON_FILE, 'utf8').then(function (raw) {
            JSONPath({ path: '$' + JSON_PATH, json: JSON.parse(raw) });
            deferred.resolve();
        });
    }
})
.on('complete', function () {
    console.log('###########################################');
    for (var i = 0; i < this.length; i++) {
        console.log(this[i].name + " " + this[i].hz + " ops/sec ("+ this[i].stats.sample.length +" runs sampled)");
    }
    console.log('Fastest is ' + this.filter('fastest').map('name'));
    console.log('Slowest is ' + this.filter('slowest').map('name'));
})
.run() 
