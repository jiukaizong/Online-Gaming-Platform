const express = require('express');
const app = express();
const server = require("http").createServer();
const io  = require("socket.io")(server);
const path = require("path")
const port = 3000
const mongoose =  require("mongoose");
mongoose.connect("mongodb://localhost/game");

//middle ware
var bodyParser = require('body-parser');
var cookieParser = require("cookie-parser");
app.use(bodyParser.urlencoded({extended:true}));
app.use(bodyParser.json())
app.use(cookieParser())
app.use(express.static(path.join(__dirname,"views")));

var studentSchema = mongoose.Schema({
    username:String,
    password:String,
    is_public:{type:String,default:"public"},
    win_rate:{type:mongoose.Schema.Types.Decimal128,default:0},
    sum_game:{type:Number,default:0},
    state:{type:String,default:"offline"},
    ctime:{type:Date,default:Date.now},
});

var gameSchema = mongoose.Schema({
    name:{type:String,default:"New Connect4 Game"},
    first_user:{id:mongoose.Schema.Types.ObjectId,name:String},
    second_user:{id:mongoose.Schema.Types.ObjectId,name:String},
    is_public:{type:String,default:"public"},
    state:{type:String,default:"waiting"},
    winner:{id:mongoose.Schema.Types.ObjectId,name:String},
    moves:[Number],
    round:{type:Number,default:0},
    ctime:{type:Date,default:Date.now},
});

var friendSchema = mongoose.Schema({
    request_user:{id:mongoose.Schema.Types.ObjectId,name:String},
    accept_user:{id:mongoose.Schema.Types.ObjectId,name:String},
    state:{type:String,default:"waiting"},
    ctime:{type:Date,default:Date.now},
    
})

var Student = mongoose.model("student",studentSchema);
var Game = mongoose.model("game",gameSchema);
var Friend = mongoose.model("friend",friendSchema);
var wait = {};
var game = {};
var chat = {};

var user = {};


io.on("connect",(socket)=>{
    console.log("有一个客户端连接上了：",socket.id);
    var count = 0;
    socket.join("room");
    socket.on("send_message",(msg)=>{
        console.log(msg);
        socket.to("room").emit("get_message",++count,{msg:msg+"I am server"});
    })
});


app.get('/',(req, res) =>{
    //login or not
    console.log(req.cookies);
    var user_id = req.cookies["user_id"];
    if(!user_id){
        res.redirect('/login');
    }   
});


app.post("/login",(req,res)=>{
    var username = req.body.username;
    var password = req.body.password;
    Student.findOne({username:username,password:password},(err,result)=>{
        if(result){
            console.log("sign in success",result._id);
            res.cookie("user_id",result._id.toString(),{maxAge:3600*1000,httpOnly:true});
            res.cookie("username",result.username.toString(),{maxAge:3600*1000,httpOnly:true});
            res.json({user_id:result._id});
        }
        else{
            res.json({user_id:-1});
        }
    })
})

app.post("/history",(req,res)=>{
    var user_id = req.cookies["user_id"];
    if(!user_id){
        res.redirect('/login');
    }   
    var game_list=[];
    Game.find({$or:[{"first_user.id":user_id},{"second_user.id":user_id}],state:"complete"},(err,docs)=>{
        for(var doc of docs){
            game_list.push({name:doc.name,id:doc._id,ctime:doc.ctime});
        }
        res.json({game_list:game_list});
    })
});

app.post("/watch_game",(req,res)=>{
    var game_id = req.body.game_id;
    
    Game.findById(game_id,(err,doc)=>{
        res.json({game_info:doc});
    });
})


app.post('/get_history_game',(req,res)=>{
    var user_id = req.cookies["user_id"];
    if(!user_id){
        res.redirect('/login');
    } 
    var moves=[];
    var user_round = 0;
    var game_id = req.body.game_id;
    Game.findById(game_id,(err,doc)=>{
        moves = doc.moves;
        if(user_id==doc.second_user.id)
            user_round=1;
        res.json({moves:moves,user_round:user_round})
    })
})


app.post("/",(req,res)=>{
    console.log(req.cookies);
    var user_id = req.cookies["user_id"];
    if(!user_id){
        res.json({user_id:-1});
        return;
    }
    Student.findByIdAndUpdate(user_id,{state:"online"},(err,doc)=>{});
    if(!user[user_id.toString()]){
        user[user_id.toString()] = io.of('/user'+user_id);
        user[user_id.toString()].on("connect",socket=>{
            console.log("user"+user_id+"connect his namespace");
            socket.on("send_request",(msg)=>{
                console.log("in send_request:")
                console.log(msg);
                user[msg.accept_user_id.toString()].emit("receive_request",{name:req.cookies.username,request_user_id:user_id});   
            });
            socket.on("send_accept",msg=>{
                console.log("in send_accept:")
                console.log(msg);
                user[msg.request_user_id.toString()].emit("receive_accept",{name:req.cookies.username,accept_user_id:user_id});
            });
            socket.on("disconnect",socket=>{
                console.log("user "+user_id+" disconnect");
                Student.findByIdAndUpdate(user_id,{state:"offline"},(err,doc)=>{});
            });
        });
        
    }
    var game_list=[];
    Game.find({state:{$ne:"waiting"},is_public:"public"},(err,docs)=>{
        if(!docs){
            return;
        }
        for (var doc of docs){
            if(doc.first_user.id==user_id || doc.second_user.id==user_id)
                continue;
            else{
                game_list.push({id:doc._id,name:doc.name,ctime:doc.ctime,state:doc.state});
            }
        }
        res.json({game_list:game_list,user_id:user_id});
    });
    
   
});

app.post("/get_friends", (req,res)=>{
    var user_id = req.cookies["user_id"];
    if(!user_id){
        res.json({user_id:-1});
        return;
    }
    var friend_list = [];
    Friend.find({$or:[{"request_user.id":user_id},{"accept_user.id":user_id}]},(err,docs)=>{
        if(!docs){
            res.json({friend_list:friend_list});
            return;
        }
        for(var doc of docs){
            temp = {};
            if(doc.request_user.id == user_id){
                temp = {id:doc.accept_user.id}
                Student.findById(doc.accept_user.id,(err,result)=>{
                    temp.state = result.state;
                    temp.name = result.username;
                    friend_list.push(temp);
                });
            }
            else if(doc.accept_user.id==user_id){
                temp = {id:doc.request_user.id};
                Student.findById(doc.request_user.id,(err,result)=>{
                    temp.state = result.state;
                    temp.name = result.username;
                    friend_list.push(temp);
                });
            }
        }
        var interval = setInterval(()=>{
            if(friend_list.length==docs.length){
                res.json({friend_list:friend_list});
                clearInterval(interval);
            }
        },500);
    });
    
})


app.post("/add_friend",(req,res)=>{
    var accept_user_id = req.body.accept_user_id;
    var request_user_id = req.cookies.user_id;
    new Friend({request_user:{id:request_user_id},accept_user:{id:accept_user_id}}).save((err,doc)=>{
        res.json({result:0})
    })
})

app.get("/users",(req,res)=>{
    var search_username = req.query.name;
    var user_id = req.cookies.user_id;
    var searched_users = [];
    Student.find({username:{$regex:search_username},state:"online",_id:{$ne:user_id}},(errr,docs)=>{
        if(!docs){
            res.json({searched_users:searched_users});
            return;
        }
        for(var doc of docs){
            searched_users.push({name:doc.username,id:doc._id});
        }
        res.json({searched_users:searched_users});
        
    })
})

app.get("/user/:user",(req,res)=>{
    var username = req.params.user;
    Game.find({$or:[{"first_user.name":username},{"second_user.name":username}]},(err,docs)=>{
        res.json({game_list:docs});
    })
})


app.post("/delete_friend",(req,res)=>{
    var user_id = req.cookies.user_id;
    var delete_user_id = req.body.delete_user_id;
    Friend.findOneAndDelete({$or:[{"request_user.id":user_id,"accept_user.id":delete_user_id},{"request_user_id":delete_user_id,"accept_user.id":user_id}]},(err,doc)=>{
        res.json({result:0});
    })
})

app.post("/creategame",(req,res)=>{
    var user_id = req.cookies["user_id"];
    if(!user_id){
        res.json({game_id:-1});
    }
    Game.find({"first_user.id":{$ne:mongoose.Types.ObjectId(user_id)},
                "state":"waiting"},(err,result)=>{
                if(result.length>0){
                    wait[result[0]._id.toString()].emit("wait","success");

                    game[result[0]._id.toString()] = io.of("/game"+result[0]._id.toString());
                    game[result[0]._id.toString()].on("connect",socket=>{
                        console.log(`game ${result[0]._id.toString()} join one user`);
                        socket.on("send_move",move=>{
                            console.log(move);
                            console.log("move:"+move.move);
                            var move_list=null;

                            Game.findById(move.game_id,(err,doc)=>{
                                console.log("找到列表")
                                move_list = doc.moves;
                                move_list.push(move.move);
                                Game.findByIdAndUpdate(move.game_id,{moves:move_list},(err,doc)=>{
                                
                                });
                            });

                            socket.broadcast.emit("receive_move",move.move);
                        });
                    });

                    chat[result[0]._id.toString()] = io.of("/chat"+result[0]._id.toString());
                    chat[result[0]._id.toString()].on("connect",socket=>{
                        console.log(`game ${result[0]._id.toString()} join one chatter`);
                        socket.on("send_message",msg=>{
                            socket.broadcast.emit("receive_message",msg);
                        });
                    })
                    Game.findByIdAndUpdate(result[0]._id,{state:"active",second_user:{id:user_id,name:req.cookies.username}},(err,doc)=>{
                        console.log(doc);
                    });
                    
                    res.json({"game_id":result[0]._id,round:1});
                }
                else{
                    var new_game = new Game({name:req.body["gameName"],first_user:{id:user_id,name:req.cookies.username},is_public:req.body["is_public"]});
                    new_game.save((err,doc)=>{
                        wait[doc._id.toString()] = io.of("/wait"+doc._id.toString());
                        wait[doc._id.toString()].on("connect",socket=>{
                            console.log(`game ${doc._id} is waiting`);
                        });
                        res.json({"game_id":doc._id,round:0});
                    });
                }
            });
})

app.post("/gameover",(req,res)=>{
    var winner_round = req.body.winner_round;
    var game_id = req.body.game_id;
    var user_round = req.body.user_round;

    if(user_round==winner_round){
        var user_id = req.cookies.user_id;
        Game.findByIdAndUpdate(game_id,{winner:{id:user_id},state:"complete"},(err,doc)=>{
            console.log("complete game"+game_id);
            res.json({result:"complete game"})
        })
    }
    else{
        res.json({result:"you are lost"});
    }
})

app.post("/signup",(req,res)=>{
    var username = req.body.username;
    var password = req.body.password;
    Student.find({username:username},(err,docs)=>{
        if(docs && docs.length>0){
            res.json({user_id:-1,msg:"The username exists,please input another username"});
            return;
        }
        else{
            var new_student = new Student({username:username,password:password}).save((err,result)=>{
                console.log("sign up success",result._id);
                res.cookie("username",result.username.toString(),{maxAge:3600*1000,httpOnly:true});
                res.cookie("user_id",result._id.toString(),{maxAge:3600*1000,httpOnly:true});
                res.json({user_id:result._id});  
            });
        }
    })
    
})








app.listen(port, () => console.log(`Example app listening on port ${port}!`))

server.listen(3001, () => console.log(`Example app listening on port ${3001}!`))

