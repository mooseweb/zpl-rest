var fs = require('fs');
var path = require('path');

// config stuff
const ConfigHandler = require('./lib/config.js');
const config = ConfigHandler.getConfig();

var express = require('express')
var favicon = require('serve-favicon')
var session = require('express-session')

// express stuff
var rest = express()

// ejs
//ejs
rest.set('view engine', 'ejs');
rest.use(express.static(__dirname + '/html'));
rest.use(favicon(path.join(__dirname, 'html', 'favicon.ico')))

//may edit session secret
// Session config
rest.use(session({
  secret: config.secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 36000000
  }
}))

// JSON
rest.use(express.json());



// datastorage stuff
if (!fs.existsSync(__dirname + '/db')) {
  fs.mkdirSync(__dirname + '/db');
}

// data storage
var db = require('diskdb');
db.connect(__dirname + '/db', ['label', 'printer', 'jobs']);

// websocket
var WebSocketServer = require('websocket').server;
var http = require('http');

// socket for sending data to the printer
const Net = require('net');


// Main
rest.get('/', function(req, res) {
  var data = {};
  data.config = config;
  data.timespan = req.session.timespan ? req.session.timespan : 24;
  res.render('index',data);
});

// set timespan for index
rest.post('/rest/timespan/(:timespan)', function(req, res) {
  if (!req.params.timespan) {
    return res.status(400).send('no timespan was given');
  }
  req.session.timespan = req.params.timespan;
  res.json({})
});

// Printer
rest.get('/printer', function(req, res) {
  var data = {};
  data.config = config;
  res.render('printer',data);
});

// Label
rest.get('/label', function(req, res) {
  var data = {};
  data.config = config;
  res.render('label',data);
});

// rest section
rest.get('/rest/printer', function(req, res) {
  res.json(db.printer.find())
});

rest.get('/rest/label', function(req, res) {
  res.json(db.label.find())
});

rest.get('/rest/jobs', function(req, res) {
  res.json(db.jobs.find())
});

// actuall print
rest.post('/rest/print', function(req, res) {
  var response = {};
  if (!req.body.printer) {
    return res.status(400).send('no printer id was given');
  }
  if (!req.body.label) {
    return res.status(400).send('no label id was given');
  }

  var printer = db.printer.findOne({
    _id: req.body.printer
  });
  if (!printer) {
    return res.status(400).send('given printer id was not valid');
  }
  var label = db.label.findOne({
    _id: req.body.label
  });
  if (!label) {
    return res.status(400).send('given label id was not valid');
  }

  var job = {};
  job.date = new Date();
  job.printer_id = printer._id;
  job.printer_name = printer.name;
  job.printer_address = printer.address;
  job.printer_ip = printer.address.split(':')[0];
  console.log(printer.address.split(':'));
  job.printer_port = parseInt(printer.address.split(':')[1]);
  job.label_id = label._id;
  job.label_name = label.name;
  job.label_zpl = label.zpl;
  job.data = req.body.data;


  job.zpl = label.zpl;
  for (key in job.data) {
    job.zpl = job.zpl.replace("${" + key + "}", job.data[key])
  }

  console.log((new Date()) + ' print job received', job);

  executeRequest(job, function(ret){
    job = ret;
    db.jobs.save(job);

    var broadcast = {};
    broadcast.source = "job";
    broadcast.data = job;
    broadcastMsg(broadcast);

    res.json(job)
  });

});

function executeRequest(job, callback){
  var client = new Net.Socket();
  console.log(client);

  client.setTimeout(5000, function(){
    console.error((new Date())+" "+"connection timed out");
    job.failed = true;
    job.error = "connection timed out";
    callback(job);
    client.end();
  });

  client.connect({ port: job.printer_port, host: job.printer_ip }, function() {
      client.write(job.zpl);
      job.failed = false;
      callback(job);
      client.destroy();
  });

  client.on('error', function(err) {
      console.error((new Date())+" "+err);
      job.failed = true;
      job.error = err;
      callback(job);
      client.destroy();
  });

  client.on('data', function(chunk) {
    job.printer_data = chunk;
    console.log(new Date()+" received data from printer:", chunk);
  });

  client.on('end', function() {});
}

// create or update printer
rest.post('/rest/printer', function(req, res) {
  var address = req.body.address;

  if (!address || address == "" || address.split(":").length != 2 || parseInt(address.split(":")[1]) == NaN) {
    return res.status(400).send('address is not valid');
  }
  var response;
  var broadcast = {};
  broadcast.source = "printer";
  if (req.body._id) {
    broadcast.action = "update";
    response = db.printer.update({
      _id: req.body._id
    }, req.body, {
      upsert: true
    });
  } else {
    broadcast.action = "create";
    response = db.printer.save(req.body);
  }
  broadcast.data = response;
  broadcastMsg(broadcast);
  res.json(response)
});

// create or update label
rest.post('/rest/label', function(req, res) {
  var response;
  var broadcast = {};
  broadcast.source = "label";
  if (req.body._id) {
    broadcast.action = "update";
    response = db.label.update({
      _id: req.body._id
    }, req.body, {
      upsert: true
    });
  } else {
    broadcast.action = "create";
    req.body.zpl = "^XA\n\n^XZ"
    response = db.label.save(req.body);
  }
  broadcast.data = response;
  broadcastMsg(broadcast);
  res.json(response)
});

// delete printer
rest.delete('/rest/printer/(:id)', function(req, res) {
  if (!req.params.id) {
    return res.status(400).send('no id was given');
  }
  var broadcast = {};
  broadcast.source = "printer";
  broadcast.action = "delete";
  var response = db.printer.remove({
    _id: req.params.id
  });
  broadcast.data = response;
  broadcastMsg(broadcast);
  res.json(response);
});

// delete label
rest.delete('/rest/label/(:id)', function(req, res) {
  if (!req.params.id) {
    return res.status(400).send('no id was given');
  }
  var broadcast = {};
  broadcast.source = "label";
  broadcast.action = "delete";
  var response = db.label.remove({
    _id: req.params.id
  });
  broadcast.data = response;
  broadcastMsg(broadcast);
  res.json(response);
});

// starting rest
if (config.public) {
  rest.listen(config.port, function() {
    console.log((new Date()) + " REST is listening on port %d in %s mode", config.port, "public");
  });
} else {
  rest.listen(config.port, 'localhost', function() {
    console.log((new Date()) + " REST is listening on port %d in %s mode", config.port, "localhost");
  });
}

// websocket
var server = http.createServer(function(request, response) {
  // process HTTP request. Since we're writing just WebSockets
  // server we don't have to implement anything.
});
server.listen(config.websocket_port, function() {
  console.log((new Date()) + " Websocket is listening on port " +
    config.websocket_port);
});

// create the server
wsServer = new WebSocketServer({
  httpServer: server
});

var websockt_clients = [];

// WebSocket server
wsServer.on('request', function(request) {
  console.log((new Date()) + ' Connection from origin ' + request.origin + '.');
  var connection = request.accept(null, request.origin);
  var index = websockt_clients.push(connection) - 1;

  console.log((new Date()) + ' Connection accepted.');
  connection.on('message', function(message) {});

  connection.on('close', function(connection) {
    console.log((new Date()) + " Peer " + connection.remoteAddress + " disconnected.");
    websockt_clients.splice(index, 1);
  });
});

function broadcastMsg(json) {
  for (var i = 0; i < websockt_clients.length; i++) {
    websockt_clients[i].sendUTF(JSON.stringify(json));
  }
}