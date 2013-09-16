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

// TODO find better data structure for Ind and Org selections

// Object to store bill data and methods
function billObj(name, cycles, type) {
  if(!(this instanceof billObj)) return new billObj(name, cycles);
  this.name = name;
  this.cycles = cycles || 2012;
  this.type = type || 'ind'; 
  this.indContrib = {};
  this.orgContrib = {};
  this.hits = 0;
  this.misses = 0;
  this.pols =  [];
  return this;
}

// Get the campaign finance info for all legislators
billObj.prototype.aggVoteMoney = function(question) {
  var self = this;
  async.forEach(this.votes, function(el, next) {

     // TODO reconcile pol data structure from both sources

    var pol = el;

    self.getId(pol, function(err, json) {
      if (err) {
        console.log(err);
        self.misses += 1;
        return next();
      }

      self.getIndContrib(pol, function(err) {
        if (err) {
          console.log(err);
          self.misses += 1;
          return next();
        } else {
          self.hits += 1;
          return next();
        }
      });

    });
  }, function() {
    if (self.type == 'ind') {
      self.contrib = self.sortResults(self.indContrib);
    } else if (self.type == 'org') {
      self.contrib = self.sortResults(self.orgContrib);
    }

    console.log('****************QUERY COMPLETE!*******************');
    console.log(question);
    console.log('Year: ' + self.cycles);
    console.log('\nHits: ' + self.hits + ' | Misses: '+ self.misses + '\n');

    // only see the first 5 donors
    self.contrib = self.contrib.splice(0, 5);

    /*
    console.log('**************' + self.name + ' Votes Money Sum******************');
    console.dir(self.contrib);
    */

    self.contrib.forEach(function (el) {
      el[1] = el[1]/self.hits;
    });

    // indcontrib is now a json object
    Object.keys(self.indContrib).forEach(function(el) {
      self.indContrib[el] = self.indContrib[el]/self.hits;
    });


    console.log('**************' + self.name + ' Votes Money Avg******************');
    console.dir(self.contrib);
    // console.log(self.indContrib);
  });
};

// TODO reconcile the id lookup inputs from both
// TODO Figure out how to reconcile the politicians name in for the error messages

// lookup the transparency id from the bioguide ID, store as pol.id
billObj.prototype.getId = function(pol, cb) {
  influence.entityIdLookup(null, null, pol.bioguide_id, function(err, json) {
    if (err) return cb(new Error('ID lookup ERROR for ' + pol.first_name + ' ' + pol.last_name + ' | err: ' + err.message));
    if (typeof json[0] == 'undefined') return cb(new Error('ID lookup failed for ' + pol.first_name + ' ' + pol.last_name));
    pol.id = json[0].id;
    return cb(null, pol);
  });
};

// TODO Figure out how to reconcile the politicians name in for the error messages
// TODO Refactor contribution function - billObj.prototype.getContrib = function(){};


// Get the campaign contributions by industry
billObj.prototype.getIndContrib = function(pol, cb) {
  var self = this;

  influence.topIndustries(pol.id, self.cycles, null, function(err, json) {
    if (err) {
      return cb(new Error('Campaign Finance lookup ERROR for ' + pol.first_name + ' ' + pol.last_name + ' | err: ' + err.message));
    }
    if (json.length > 0) {

      // increment the contrib object with these results
      json.forEach(function(el, index, array) {
        if (el.name in self.indContrib) { 
          self.indContrib[el.name] += parseInt(el.amount);
        } else {
          self.indContrib[el.name] = parseInt(el.amount);
        }
      });
      return cb(null);
    } else {
      return cb(new Error('Campaign Finance lookup failed for ' + pol.first_name + ' ' + pol.last_name));
    }
  });
};

// sort campaign finance results from largest to smallest
billObj.prototype.sortResults = function(contrib) {
  var self = this;
  var sortable = [];
  for (var contributor in contrib)
    sortable.push([contributor, contrib[contributor]]);
  sortable.sort(function(a, b) {return b[1] - a[1]});
  return sortable;
};


// TODO create a joint interface for starting the lookup - calling the aggVoteMoney method
// TODO combine voteSuccess with rollSuccess, doing this with one API call

// Congress API call success functions

var votesSuccess = function(data) {
  var votes = data.results;
  var amendments = votes.filter(function(el) {
    return el.roll_type.indexOf('Amendment') > 0
  });

  amendments.forEach(function(el) {
    getRoll(el.roll_id, el.bill_id);
  });
}


var rollSuccess = function(data) {
  var voters = data.results[0].voters;
  var question = data.results[0].question;

  var yesVotes = [];
  var noVotes = [];

  // TODO Abstract figuring out how each politician voted, use one list for yesVotes and noVotes

  Object.keys(voters).forEach(function(el) {
    if (voters[el].vote == "Yea") {
      yesVotes.push(voters[el].voter);
    } else if (voters[el].vote == "Nay") {
      noVotes.push(voters[el].voter);
    }
  });

  // TODO Combine the two data aggregation objects into one, or ... yea ... 
  /* TODO MINIMIZE API CALLS. SHORT: COMBINE THE yesData and noData lists, but sort out the votes so we don't have to
   *      make double the API calls. LONG: Get this shit in a database man, its about time we start figuring out the 
          service and structure.  
   */

  // init data aggregation objects
  var yesData = new billObj('Yes', [2010, 2012]);
  var noData = new billObj('No', [2010, 2012]);

  yesData.votes = yesVotes;
  noData.votes = noVotes;

  yesData.aggVoteMoney(question);
  noData.aggVoteMoney(question);
}

// TODO update the existing Congress API client with the ability to pass a callback to the callback...
// TODO ... or something like that.

// get the votes on the bill, expects only 1 bill returned
function getVotes(bill_id) {
  api.votes() 
    .filter("bill_id", bill_id)
    .fields("voters", "question")
    .call(votesSuccess)
}

// TODO getRoll may be redundant. Can I filter by voters initially, so I don't have to do 2 api calls?
/* 
function getRoll(roll_id) {
  api.votes()
    .filter("bill_id", bill_id)
    .call(rollSuccess)
}*/

// TODO abstract initializing, and make it work for either bill type - accept a formatter variable and the id.

var bill_id = "s649-113";

getVotes(bill_id);