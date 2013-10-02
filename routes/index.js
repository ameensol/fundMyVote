var Bill = require('../fundMyVote');

// GET home page
exports.index = function(req, res) {
  res.render('index.html', {
    what: "World"
  });
}

// POST home page
exports.submit = function(req, res) {
  var state = req.body.state,
      year = req.body.year,
      bill_id = req.body.bill_id,
      cycles = req.body.cycles,
      type = req.body.type,
      print = req.body.print;

  console.log(state);
  console.log(year);
  console.log(bill_id);
  console.log(cycles);
  console.log(type);
  console.log(print);

  var bill = new Bill(state, year, bill_id, cycles, type, print);

  bill.billLookup(function(err, bill) {
    if (err) return new Error(err);
    bill.aggVoteMoney(function(err, json) {
      if (err) return new Error(json);
      res.render('index.html', {
        json: json,
        print: print
      });
    });
  });
}