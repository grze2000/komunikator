var db = require('./database'),
	express  = require('express'),
	app = express(),
	http = require('http').Server(app),
	io = require('socket.io')(http),
	bodyParser = require('body-parser'),
	session = require('express-session')({
		secret: 'secret',
		resave: true,
		saveUninitialized: true,
		unset: 'destroy'
	}),
	sharedsession = require("express-socket.io-session"),
	version = '2019.1.1 (closed beta)';

app.set('views', __dirname+'/views');
app.set('view engine', 'ejs');
app.use(express.static(__dirname + '/'));
app.use(session);
app.use(bodyParser.urlencoded({extended: true}));
io.use(sharedsession(session));

app.get('/login', function(req, res) {
	if(!req.session.userID) {
		res.render('login', {version: version});
	} else {
		res.redirect('/');
	}
});

app.get('/', function(req, res) {
	var userID = req.session.userID;
	if(userID) {
		db.getUserInfo(userID, function(error, user) {
			if(error) {
				res.render('error', {error: {code: 'Database error', message: error}});
			} else {
				db.getChats(userID, function(chats) {
					db.getMessages(chats[0].id, function(messages) {
						res.render('dashboard', {user: user, chats: chats, messages: messages, version: version});
					});
				});
			}
		});
	} else {
		res.redirect('/login');
	}
});

app.get('/logout', function(req, res) {
	req.session.destroy(function() {
		res.redirect('/login');
	});
});

app.post('/login', function(req, res) {
	var post = req.body;
	if(post.username === "" || post.password === "") {
		res.render('login', {message: 'Wypełnij wszystkie pola!', version: version});
	} else {
		db.userExists(post.username, post.password, function(error, exists, user) {
			if(error) {
				res.render('error', {error: {code: 'Database error', message: error}});
			} else {
				if(exists) {
					req.session.userID = user.id;
					req.session.user = {firstname: user.firstname};
					res.redirect('/');
				} else {
					res.render('login', {message: 'Nieprawidłowy login lub hasło!', version: version});
				}
			}
		});
	}
});

app.get('/register', function(req, res) {
	if(!req.session.userID) {
		res.render('register', {version: version});
	} else {
		res.redirect('/');
	}
});

app.get('/changelog', function(req, res) {
	res.render('changelog');
});

app.get('/info', function(req, res) {
	res.render('info');
});

function twoDigits(number) {
	if(number < 10) return '0'+number.toString();
	else return number.toString();
}

function getDatetime() {
	var date = new Date();
	return date.getFullYear()+'.'+twoDigits(date.getMonth()+1)+'.'+twoDigits(date.getDate())+' '+twoDigits(date.getHours())+':'+twoDigits(date.getMinutes());
}

io.on('connection', function(socket) {
	if(socket.handshake.session.userID == null) {
		socket.disconnect();
		return false;
	} else {
		socket.userID = socket.handshake.session.userID;
		socket.user = socket.handshake.session.user;
		console.log('Connected user with id: '+socket.userID);
	}
	socket.on('msg', function(data) {
		db.sendMessage(data.chat, socket.userID, data.message, function(users) {
			Object.keys(io.sockets.sockets).forEach(function(id) {
				if(users.includes(io.sockets.sockets[id].userID)) {
					db.getChats(io.sockets.sockets[id].userID, function(chats) {
						db.getMessages(chats[0].id, function(messages) {
							io.sockets.sockets[id].emit('message', {userID: io.sockets.sockets[id].userID, chat: data.chat, chats: chats, messages: messages});
						});
					});
				}
			});
		})
		console.log('New message: '+data.message+' Chat: '+data.chat);
	});
	socket.on('getMessages', function(data) {
		db.userInGroup(data.chat, socket.userID, function(inGroup) {
			if(inGroup) {
				db.getMessages(data.chat, function(messages) {
					socket.emit('messageList', {messages: messages, id: socket.userID});
				});
			}
		});
	});
	socket.on('search', function(data) {
		db.searchUser(data.query, function(results) {
			socket.emit('search', {results: results});
		});
	});
	socket.on('getChats', function() {
		db.getChats(socket.userID, function(chats) {
			socket.emit('getChats', {chats: chats});
		});
	})
	socket.on('openChat', function(data) {
		db.privateChatExists(socket.userID, data.id, function(results) {
			if(results.length > 0) {
				db.getChats(socket.userID, function(chats) {
					if(chats.map(({id}) => id).includes(results[0].id) == false) {
						chats.unshift(results[0]);
					}
					db.getMessages(results[0].id, function(messages) {
						socket.emit('openChat', {userID: socket.userID, chatID: results[0].id, chats: chats, messages: messages});
					});
				});
			} else {
				db.createPrivateChat({id: socket.userID, firstname: socket.user.firstname}, data.id, function(groupID) {
					db.getChats(socket.userID, function(chats) {
						socket.emit('openChat', {userID: socket.userID, chatID: groupID, chats: chats, messages: [{sender_id: -1, text: socket.user.firstname+' utworzył(a) czat', sent: getDatetime()}]});
					});
				});
			}
		});
	});
});

http.listen(3000, function(){
	console.log('Listening on port 3000');
});