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
var Piffero = require('../dist/index.js').Piffero;

// config
var JSON_FILE = '../spec/jsonFiles/large-file.json';
var JSON_PATH = '[11350].payload.issue.user.received_events_url';
var STREAMPARSER_PATH = ('$' + JSON_PATH).replace(/\[(\d+)\]/g, '.$1').replace(/^\.\./, '.');
// var JSON_PATH = '[5000].payload';
// var JSON_PATH = '[1].payload';

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
