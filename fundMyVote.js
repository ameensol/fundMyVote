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

var Bill = module.exports = function (state, year, bill_id, cycles, type, print) {
  if(!(this instanceof Bill)) return new Bill(state, year, bill_id, cycles, type, print);
  this.state = state;
  this.year = year;
  this.bill_id = bill_id;
  this.cycles = cycles || 2012;
  this.type = type;
  this.print = print;
  this.contrib = {};
  this.misses = 0;
  this.hits = 0;
  this.yesHits = 0;
  this.noHits = 0;
  return this;
}

// Create a politician object with only the important information
function Politician(vote, bioguide_id, full_name, party) {
  if(!(this instanceof Politician)) return new Politician(vote, bioguide_id, full_name);
  this.vote = vote;
  this.bioguide_id = bioguide_id;
  this.full_name = full_name;
  this.party = party;
  return this;
}

// lookup the bill by its id, and get the voting record
Bill.prototype.billLookup = function(cb) {
  var self = this;

  openstates.billDetail(self.state, self.year, self.bill_id, function(err, json) {
    if (err) return cb(new Error('Bill lookup error | err: ' + err.message));
    if (typeof json == 'undefined') return cb(new Error('Bill lookup failed'));
    console.log('Bill Detail received');

    self.votes = [];

    json.votes[0].no_votes.forEach(function(e) {
      e.vote = "Nay";
      self.votes.push(e);
    });

    json.votes[0].yes_votes.forEach(function(e) {
      e.vote = "Yea";
      self.votes.push(e);
    });

    cb(null, self)
  });
};

// Get the campaign finance info for all legislators
Bill.prototype.aggVoteMoney = function(cb) {
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
          if (pol.vote == 'Yea') self.yesHits += 1;
          if (pol.vote == 'Nay') self.noHits += 1;
          self.hits += 1;
          return next();
        }
      };

      if(self.type === 'i') self.getIndContrib(pol, getContribCb);
      if(self.type === 'o') self.getOrgContrib(pol, getContribCb);

    });
  }, function() {

    if(self.print) {
      self.li = self.sortResults();
      self.logResults();
    }

    return cb(null, JSON.stringify(self.toArray(self.findAvg(self.contrib))));
  });
};

Bill.prototype.logResults = function() {
  var self = this;

  console.log('****************QUERY COMPLETE!*******************');
  console.log(self.question);
  console.log('Year: ' + self.cycles);
  console.log('\nHits: ' + self.hits + ' | Misses: '+ self.misses + '\n');
  console.log('************** Votes Money Avg******************');

  console.dir(JSON.stringify(self.toArray()));

};

Bill.prototype.findAvg = function(contrib) {
  var self = this;
  Object.keys(contrib).forEach(function(el) {
    contrib[el].yes = Math.round(contrib[el].yes/self.yesHits * 100) / 100; 
    contrib[el].no = Math.round(contrib[el].no/self.noHits * 100) / 100;
  });
  return self.contrib;
};

Bill.prototype.toArray = function(contrib) {
  var array = [];
  Object.keys(contrib).forEach(function(el) {
    array.push([el, contrib[el]]);
  });
  return array;
};

// sort campaign finance results from largest to smallest
Bill.prototype.sortResults = function() {
  var self = this;
  var sortable = [];
  for (var contributor in self.contrib)
    sortable.push([contributor, self.contrib[contributor]]);
  sortable.sort(function(a, b) {

    return b[1] - a[1];
  });
  sortable.forEach(function (el) {
    el[1] = el[1]/self.hits;
  });
  return sortable;
};

// TODO reconcile the id lookup inputs from both
// TODO Figure out how to reconcile the politicians name in for the error messages

// lookup the transparency id from the bioguide ID, store as pol.id
Bill.prototype.getId = function(pol, cb) {

  // State Legislators
  if (pol.leg_id) {
    openstates.legDetail(pol.leg_id, function (err, json) {
      if(err) return cb(new Error('ID lookup ERROR for ' + pol.name + ' | err: ' + err.message));
      if (typeof json == 'undefined') return cb(new Error('ID lookup failed for ' + pol.name));
      pol.full_name = json.full_name;
      pol.id = json.transparencydata_id;
      return cb(null, pol);
    });
  }
};

// TODO Figure out how to reconcile the politicians name in for the error messages
// TODO Refactor contribution function - Bill.prototype.getContrib = function(){};

// Get the campaign contributions by industry
Bill.prototype.getIndContrib = function(pol, cb) {
  var self = this;
  influence.topIndustries(pol.id, self.cycles, null, function(err, json) {
    if (err) {
      return cb(new Error('Campaign Finance lookup ERROR for ' + pol.full_name + ' | err: ' + err.message));
    }
    if (json.length > 0) {
      // create a contrib object and increment it with the results
      json.forEach(function(el) {
        if (!(el.name in self.contrib)) self.contrib[el.name] = {yes: 0, no: 0};
        if (pol.vote == "Yea") self.contrib[el.name].yes += parseInt(el.amount);
        if (pol.vote == "Nay") self.contrib[el.name].no += parseInt(el.amount);
      });
      return cb(null);
    } else {
      return cb(new Error('Campaign Finance lookup failed for ' + pol.full_name));
    }
  });
};

// Get the campaign contributions by organization
Bill.prototype.getOrgContrib = function(pol, cb) {
  var self = this;
  var foundData = false;
  async.forEach(self.cycles, function(el, next) {
    influence.topContributors(pol.id, el, null, function(err, json) {
      if (err) {
        return next(new Error('Campaign Finance lookup ERROR for ' + pol.full_name + ' | err: ' + err.message));
      }
      if (json.length > 0) {
        foundData = true;
        // create a contrib object and increment it with the results
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

var state = 'NC';
var year = '2013';
var bill_id = 'HB 589';
var cycles = [2010, 2012];
var type = 'i';
var print = false;

var bill = new Bill(state, year, bill_id, cycles, type, print);

bill.billLookup(function(err, bill) {
  if (err) return new Error(err);
  bill.aggVoteMoney(function(err, json) {
    if (err) return new Error(json);
    console.log(json);
  });
});