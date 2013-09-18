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
// * accept a variable, contribType - that can be either i/o/b - and return the data accordingly
// * problem - so far the billObj is only designed for 1 lookup at a time - hits/misses is for 1 lookup
// * start just using a variable to act as a switch between the two modes - industry and organization
// * but, I can use the same object for both now, because they will never be at the same time
// * hits/misses needs to exist on the indContrib and orgContrib objects, not on the actual lookup
// * if I'm going to be putting more vars on the contrib objects, I could stand to make a contructor
// * okay, I have hits and misses on the Contrib object...
// * FUCK - Its only going to be for one at a time.

// TODO validate all inputs

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
    Votes

    Amendments
      Question
      Votes


*/
// Object to store bill data and methods
function billObj(name, cycles, type, print) {
  if(!(this instanceof billObj)) return new billObj(name, cycles);
  this.name = name;
  this.cycles = cycles || 2012;
  this.type = type;
  this.print = print;
  this.contrib = {};
  this.misses = 0;
  this.hits = 0;
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

      var getContribCb = function(err, json) {
        if (err) {
          console.log(err);
          self.misses += 1;
          return next();
        } else {
          self.hits += 1;
          return next();
        }
      };

      if(self.type === 'i') self.getIndContrib(pol, getContribCb);
      if(self.type === 'o') self.getOrgContrib(pol, getContribCb);

    });
  }, function() {

    // TODO optional view mode, put this stuff in its own function
    // * the optional view mode should also take into account the contrib type
    // TODO This spot needs to pass back the data objects - and its probably going to d3.
    /*      Format this appropriately, and figure out the best way to pass a callback through this whole system,
            be it appending it to the object... actually that is the best way... create this.callback property */
    // Okay, I'm not going to be able to do everything now - I don't know the best way to format. SO keep the list
    // * for the output, but also return the avg. 

    if(self.print) {
      self.li = self.sortResults();
      self.logResults();
    }

    // callback(findAvg(contrib));
  });
};

billObj.prototype.logResults = function() { 
  console.log('****************QUERY COMPLETE!*******************');
  console.log(question);
  console.log('Year: ' + self.cycles);
  console.log('\nHits: ' + self.hits + ' | Misses: '+ self.misses + '\n');

  /*
  console.log('**************' + self.name + ' Votes Money Sum******************');
  console.dir(contrib);
  */

  // only see the first 5 donors
  li = li.splice(0, 5);

  console.log('**************' + self.name + ' Votes Money Avg******************');
  console.dir(li);

  function findAvg() {
    Object.keys(self.contrib).forEach(function(el) {
      self.contrib[el] = self.contrib[el]/self.hits;
    });
    return self.contrib;
  }
};


// TODO reconcile the id lookup inputs from both
// TODO Figure out how to reconcile the politicians name in for the error messages

// lookup the transparency id from the bioguide ID, store as pol.id
billObj.prototype.getId = function(pol, cb) {
  influence.entityIdLookup(null, null, pol.bioguide_id, function(err, json) {
    if (err) return cb(new Error('ID lookup ERROR for ' + pol.full_name + ' | err: ' + err.message));
    if (typeof json[0] == 'undefined') return cb(new Error('ID lookup failed for ' + pol.full_name));
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
      return cb(new Error('Campaign Finance lookup ERROR for ' + pol.full_name + ' | err: ' + err.message));
    }
    if (json.length > 0) {
      // increment the contrib object with these results
      json.forEach(function(el) {
        if (el.name in self.contrib) { 
          self.contrib[el.name] += parseInt(el.amount);
        } else {
          self.contrib[el.name] = parseInt(el.amount);
        }
      });
      return cb(null);
    } else {
      return cb(new Error('Campaign Finance lookup failed for ' + pol.full_name));
    }
  });
};

// Get the campaign contributions by organization
billObj.prototype.getOrgContrib = function(pol, cb) {
  var self = this;
  // console.dir(pol);
  var foundData = false;
  async.forEach(self.cycles, function(el, next) {
    influence.topContributors(pol.id, el, null, function(err, json) {
      if (err) {
        return next(new Error('Campaign Finance lookup ERROR for ' + pol.full_name + ' | err: ' + err.message));
      }
      if (json.length > 0) {
        foundData = true;
        // increment the contrib object with these results
        json.forEach(function(el, index, array) {
          if (el.name in self.orgContrib) { 
            self.contrib[el.name] += parseInt(el.total_amount);
          } else {
            self.contrib[el.name] = parseInt(el.total_amount);
          }
        });
      }
      return next(null);
    });
  }, function(err) {
    if (err) return cb(err);
    if (!foundData) return cb(new Error('Campaign Finance lookup failed for ' + pol.full_name + ' - ' + pol.id));
    return cb(null);
  });
};

// sort campaign finance results from largest to smallest
billObj.prototype.sortResults = function() {
  var self = this;
  var sortable = [];
  for (var contributor in self.contrib)
    sortable.push([contributor, self.contrib[contributor]]);
  sortable.sort(function(a, b) {return b[1] - a[1]});
  sortable.forEach(function (el) {
    el[1] = el[1]/self.hits;
  });
  return sortable;
};


// TODO create a joint interface for starting the lookup - calling the aggVoteMoney method
// TODO combine voteSuccess with rollSuccess, doing this with one API call

// Congress API call success functions

var votesSuccess = function(data) {
  var votes = data.results;
  var amendments = votes.filter(function(el) {
    return el.roll_type.indexOf('Amendment') > 0;
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
  var yesData = new billObj('Yes', [2010, 2012], 'i', true);
  var noData = new billObj('No', [2010, 2012], 'i', true);

  yesData.votes = yesVotes;
  noData.votes = noVotes;

  yesData.aggVoteMoney(question);
  noData.aggVoteMoney(question);
}

// TODO update the existing Congress API client with the ability to pass a callback to the callback...
// TODO ... or something like that.

// get the votes on the bill, expects only 1 bill returned
function getVotes(bill_id) {
  congress.votes() 
    .filter("bill_id", bill_id)
    .call(votesSuccess)
}

// TODO getRoll may be redundant. Can I filter by voters initially, so I don't have to do 2 api calls?

function getRoll(roll_id) {
  congress.votes()
    .filter("bill_id", bill_id)
    .filter("roll_id", roll_id)
    .fields("voters", "question")
    .call(rollSuccess)
}

// TODO abstract initializing, and make it work for either bill type - accept a formatter variable and the id.

var bill_id = "s649-113";

getVotes(bill_id);

