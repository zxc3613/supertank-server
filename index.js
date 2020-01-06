var app = require('express')();
var http = require('http').createServer(app);
var io = require('socket.io')(http);
var uuidv4 = require('uuid/v4');

var rooms = [];

const maxClientNumber = 6;      //클라이언트 최대 갯수

io.on('connection', function(socket) {
    console.log('Connected, 서버에 연결을 했습니다.');

    // 방 생성
    var createRoom = function() {
        var roomId = uuidv4();
        socket.join(roomId, function() {
            var room = { roomId: roomId, clients: [{ clientId: socket.id, ready: false }]};
            rooms.push(room);
            socket.emit('res_createroom', { roomId: roomId });
        });
    }

    // 유효한 방 찾기
    var getAvailableRoomId = function() {
        if (rooms.length > 0) 
        {
            for (var i = 0; i < rooms.length; i++) 
            {
                if (rooms[i].clients.length < maxClientNumber) 
                {
                    return i;
                } 
            }
        }
        return -1;
    }

    // 클라가 서버에 접속했을때
    socket.emit('res_connect', { clientId: socket.id });

    socket.on('req_joinroom', function(data) {
        // 빈방 찾기
        var roomIndex = getAvailableRoomId();
        if (roomIndex > -1) 
        {
            // 빈방에 참여
            socket.join(rooms[roomIndex].roomId, function() {
                // room에 전체 client 수
                var clientsNumber = rooms[roomIndex].clients.length;

                // 기존 client 정보 가져오기
                // var firstRoomClient = rooms[roomIndex].clients[0].clientId;      //0번 배열 클라이언트 정보 가져오기
                var otherClientIds = [];                                           //자신뺴고 이미 들어와있는 클라이언트 정보 가져오기
                for (var i = 0; i < rooms[roomIndex].clients.length; i++)
                {
                    otherClientIds.push(rooms[roomIndex].clients[i].clientId);
                }

                // 새로운 클라이언트 정보를 rooms.clients에 추가
                var client = { clientId: socket.id, ready: false }
                rooms[roomIndex].clients.push(client);

                // 지금 방에 참여한 Client에게 보내는 메시지
                socket.emit('res_joinroom', { roomId: rooms[roomIndex].roomId, otherClientIds: otherClientIds, clientsNumber: clientsNumber });

                // 지금 방에 참여한 Client를 제외한 나머지 방에 있는 Client에게 보내는 메시지
                socket.to(rooms[roomIndex].roomId).emit('res_otherjoinroom', { roomId: rooms[roomIndex].roomId, otherClientId: socket.id, clientsNumber: clientsNumber });
            });
        } 
        else 
        {
            // 방 생성
            createRoom();
        }
    });

    // UnJoin
    socket.on('req_unjoinroom', function(data) {
        if (!data) return;
        socket.leave(data.roomId, function(result) {
            var room = rooms.find(room => room.roomId === data.roomId);
            if (room) 
            {
                var clients = room.clients;
                for (var i = 0; i < clients.length; i++) 
                {
                    if (clients[i].clientId === data.clientId) 
                    {
                        clients.splice(i, 1);
                        socket.emit('res_unjoinroom', { roomId: room.roomId });

                        // 빈방이면 rooms에서 방 정보 삭제
                        if (clients.length == 0) 
                        {
                            var roomIndex = rooms.indexOf(room);
                            rooms.splice(roomIndex, 1);
                        } 
                        else 
                        {
                            socket.to(room.roomId).emit('res_otherunjoinroom', { otherClientId: socket.id });
                        }
                    }
                }
            }
        });
    });

    socket.on('req_ready', function(data) {
        if (!data) return;

        var room = rooms.find(room => room.roomId === data.roomId);

        if (room) 
        {
            var clients = room.clients;
            var client = clients.find(client => client.clientId === data.clientId);
            if (client) 
            {
                client.ready = true;
                socket.emit('res_ready');
                socket.to(room.roomId).emit('res_otherready', { otherClientId: socket.id });
            }

            //clients의 client 수가 maxClientNumber와 같을 경우
            if (clients.length == maxClientNumber) 
            {
                var cnt = 0;
                for (var i = 0; i < clients.length; i++) 
                {
                    //ready가 true일경우 cnt 올려줘서 레디상태를 확인
                    if (clients[i].ready == true) 
                    {
                        cnt++;
                    }
                }
                if (clients.length == cnt) 
                {
                    // 모두가 True인 상황   //게임 플레이
                    io.in(room.roomId).emit('res_play');
                }
            }
        }
    });

    socket.on('req_unready', function(data) {
        if (!data) return;

        var room = rooms.find(room => room.roomId === data.roomId);

        if (room) 
        {
            var clients = room.clients;
            var client = clients.find(client => client.clientId === data.clientId);
            if (client) 
            {
                client.ready = false;
                socket.emit('res_unready');
                socket.to(room.roomId).emit('res_otherunready', { otherClientId: socket.id });
            }
        }
    });

    socket.on('req_createtank', function(data) {
        if (!data) return;

        var clientId = data.clientId;
        var roomId = data.roomId;
        var position = data.position;

        if (roomId) 
        {
            socket.to(roomId).emit('res_othercreatetank', { clientId: clientId, position: position });
        }
    });

    socket.on('req_movetank', function(data) {
        if (!data) return;

        var position = data.position;
        var roomId = data.roomId;
        var clientId = data.clientId;

        if (roomId) 
        {
            socket.to(roomId).emit('res_othermovetank', { clientId: clientId, position: position });
        }
    });

    socket.on('disconnect', function(reason) {
        console.log('Disconnect, 서버에 연결을 끊었습니다.');

        var room = rooms.find(room => room.clients.find(client => client.clientId === socket.id));
        
        if (room) 
        {
            socket.leave(room.roomId, function() {
                var clients = room.clients;
                var client = clients.find(client => client.clientId === socket.id);
                clients.splice(clients.indexOf(client), 1);
        
                // clients에 아무런 client 없다면 해당 room을 삭제
                if (clients.length == 0) 
                {
                    rooms.splice(rooms.indexOf(room), 1);
                } 
                else 
                {
                    socket.to(room.roomId).emit('res_otherunjoinroom', { otherClientId: socket.id });
                }
            });
        }
    });
});

http.listen(3000, function() {
    console.log('listening on *:3000');
});