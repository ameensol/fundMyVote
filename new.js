var async = require('async');
var fs = require('fs');

var Influence = require('./influence');
var OpenStates = require('openstates');
var congress = require("sunlight-congress-api");

// Load apiKey from config.json - you can replace this code and manually set your API key here
var nconf = require('nconf');
nconf.use('file', { file: './config.json' });
nconf.load();
var apiKey = nconf.get('apiKey');

// Initialize API's with the apiKey
var influence = new Influence(apiKey);
var openstates = new OpenStates(apiKey);
congress.init(apiKey);

function queryObj(bill, source, cycles, type, amends, print, callback) {
  if(!(this instanceof queryObj)) return new queryObj(bill, source, cycles, type, amends, print, callback);
  this.bill = bill;
  this.source = source;
  this.cycles = cycles;
  this.type = type;
  this.amends = amends;
  this.print = print;
  return this;
  // TODO validate all inputs
}

/*
Query
  Source
  Cycles
  Type
  Print
  Bill
    Id
    Type
    Chamber
    ...
    Votes -> getAgg()

    Amendments
      Question
      Votes -> getAgg()


*/