/************** RESOURCES

Google Code Labs
https://github.com/googlecodelabs/webrtc-web/blob/c96ce33e3567b40cd4a5d005186554e33fb8418c/step-05/js/main.js

Mozilla Developer Network
https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection
https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Signaling_and_video_calling

WebRTC Github - example
https://github.com/webrtc/apprtc

Sam Dutton
https://www.html5rocks.com/en/tutorials/webrtc/basics/

Gabriel Tanner
https://gabrieltanner.org/blog/webrtc-video-broadcast

COR errors
https://stackoverflow.com/questions/57181851/how-to-make-webrtc-application-works-on-the-internet

Shane Tully
https://shanetully.com/2014/09/a-dead-simple-webrtc-example/
*/

'use strict';
let room = null;
var socket = io.connect();

//create the bilateral communication object, RTCpeerconnection
//will have the local and remote connection information, will need to get info from
//handshake on the socket to use

//first, make the connection objects
var iceConfig = {
        'iceServers':[
          {
            'urls': 'stun:stun.l.google.com:19302'
          },
          {
            'urls': 'turn:192.158.29.39:3478?transport=udp',
            'credential': 'JZEOEt2V3Qb0y27GRntt2u2PAYA=',
            'username': '28224511:1379330808'
        },
        {
            'urls': 'turn:192.158.29.39:3478?transport=tcp',
            'credential': 'JZEOEt2V3Qb0y27GRntt2u2PAYA=',
            'username': '28224511:1379330808'
         }
        ]
      };
/////////////////////// CONSTRAINTS FOR getUserMedia //////////////////////////
// https://developer.mozilla.org/en-US/docs/Web/API/Media_Streams_API/Constraints

/* *******  iPhone issue ********* 
https://bugs.webkit.org/show_bug.cgi?id=208667
https://stackoverflow.com/questions/63084076/ios13-getusermedia-not-working-on-chrome-and-edge

when constraints has audio:false, iphone can connect
to the app when it's on heroku.  Else, it can't.  Suspect it's related
to only allowing video? idk, but it's annoying 30nov2020
*/

//if iPhone user agent, ONLY set video constraint, else include audio and width/height
const constraints = navigator.userAgent.includes("iPhone") ? {video:true} : {
    audio:true,
      video: {
          width: { ideal: 640 },
          height: {ideal: 400 }
          }    
    };

////////////////////// GLOBAL TO HOLD CONNECTIONS ////////////////////////////////
/*move this to a closure at some point*/
const allPeerConnections = {};

//////////////////////////  GET USER MEDIA //////////////////////////
navigator.mediaDevices.getUserMedia(constraints).then(setLocalVideo);
/* best is use an arrow function for setLocalVideo stream, done this way to make reading easier*/
//////////////////////////  DISPLAY USER MEDIA for LOCAL //////////////////////////
function setLocalVideo(stream){
  let localVideo = document.querySelector('#localVideo');
  localVideo.srcObject = stream;
}
///// Clicking the ENTER button starts everything.  The UI is pretty bad, there is no
//indication anything is working or connecting.  could add that but didn't.  Just know
//when you click enter, server is trying to get you to other peers in the room
const startButton = document.getElementById('submit');

//once we get input from user, set room and pass then connect to server
startButton.onclick = (() =>{  
  room = document.getElementById('room').value;
  /*
  -- PASSWORDS --
  technically everything is built and tested to use passwords
  I hid the html element, commented out the getElementBy but gave it a value of 1234.  the server applies a default '1234' to all rooms
  because this is a simple demo app not something for protection and entering room +pass 
  was annoying
  */

  let password = '1234' //document.getElementById('password').value;
  console.log(room,password)

  if (room !== '') {
    socket.emit('create or join', room,password);
    console.log('Asking server to create or join room: ', room);
    }
});

//Start our connection to the server
socket.on('connect',(msg)=>{
  console.log("CONNECTED");
});

//response back if Client joined a room with other clients
//this will cause Client to start the RTCpeerconnection handshake they will be the
// 'offer' client
socket.on("newRoomMember", (room,ids) => {
  //ids an array of socket.IDs of other members
  //loop through all the room members and send offer to connect
  for (var socketID of ids){
    //make an offer to one of the clients in the room
    const remotePeerConnection = createPeerConnectionOffer(socketID);

    //associate this rPC with the specific socketID so peer-peer comms can happen
    allPeerConnections[socketID] = remotePeerConnection;

    //create handler for the .onicecandidate method of RTCPeerConnection instance 
    remotePeerConnection.onicecandidate = event => {
        if (event.candidate) {
          socket.emit("candidate", socketID, event.candidate);
        }
      };
    }
});

async function addMediaTrackToRemotePeerConnection(remotePeerConnection){
//IMPORTANT - everything has to wait for userMedia, so it's all chained to that promise .then()
 //https://stackoverflow.com/questions/38036552/rtcpeerconnection-onicecandidate-not-fire
 const stream = await navigator.mediaDevices.getUserMedia(constraints);

  //Add our local media tracks (audio/video) to the rPC object we are connecting through
  stream.getTracks().forEach(track => remotePeerConnection.addTrack(track, stream));

  //return remotePeerConnection with its new tracks
  return remotePeerConnection;
}

function createPeerConnectionOffer (RemoteSocketID){
  //iceConfig global 
  const remotePeerConnection = new RTCPeerConnection(iceConfig);
  //IMPORTANT - everything has to wait for userMedia
 addMediaTrackToRemotePeerConnection(remotePeerConnection)
 .then((rpc) =>{
    //Now that the rpc 'remotePeerConnection' has our media tracks associated, we can start the offer process.
    rpc.createOffer()
      //createOffer returns our local network description
      .then(sdp => {
        rpc.setLocalDescription(sdp);
        return sdp;
      })
      .then((sdp) => {
          socket.emit("offer", RemoteSocketID, sdp);
        })
    })
 .catch(learnFromMistakes);

  return remotePeerConnection;
}

function createPeerConnectionAnswer (RemoteSocketID,description){
//iceConfig global 
const remotePeerConnection = new RTCPeerConnection(iceConfig);
//IMPORTANT - everything has to wait for userMedia
 addMediaTrackToRemotePeerConnection(remotePeerConnection)
 //add the remote client description to the rpc 
 .then(remotePeerConnection.setRemoteDescription(description))
 //create a local description Object
 .then(() => remotePeerConnection.createAnswer())
 //attach the local description to the rpc 
 .then(sdp => remotePeerConnection.setLocalDescription(sdp))
 //finally, fire the answer back
 .then(() => {
  socket.emit("answer", id, remotePeerConnection.localDescription);
  })
  .catch(learnFromMistakes);
}

function createRemoteVideoHTMLNode (id){

  //*create a new video element to show our remote video
  const remoteVideo = document.createElement("video");
  //set it to autoplay video
  remoteVideo.autoplay = true;
  //set the inline play
  remoteVideo.setAttribute('playsinline','');
  //give it the socket id as an id so we can reference easily
  remoteVideo.setAttribute("id",id);
  //attach our remote video element to container, 
  document.getElementById('remoteVideoContainer').appendChild(remoteVideo)
  return;
}
socket.on("offer", (id, description) => {
  //////// SO Similar to the createPeerConnectionOffer flow, should really combine in to a few single working functions

  //create a video element to hold the remote stream
  createRemoteVideoHTMLNode (id);

  //create a new RTCPeerConnection object to be associated with this offer
  const remotePeerConnection = new RTCPeerConnection(iceConfig);
  
  allPeerConnections[id] = remotePeerConnection;
  navigator.mediaDevices.getUserMedia(constraints)
 .then(
   (stream)=>{
     stream.getTracks().forEach(track => remotePeerConnection.addTrack(track, stream));
     return remotePeerConnection
   })
   .then(
  remotePeerConnection.setRemoteDescription(description)
    ).then(
      () => remotePeerConnection.createAnswer()
      )
    .then(sdp => remotePeerConnection.setLocalDescription(sdp))
    .then(() => {
      socket.emit("answer", id, remotePeerConnection.localDescription);
    });

    //trying to fix issue with iphone, mannually add tracks to a MediaSource?
  remotePeerConnection.ontrack = event => {
    let remoteVideoElement = document.getElementById(id);
    //set the remote stream to our video html element
    remoteVideoElement.srcObject = event.streams[0];
  };
  remotePeerConnection.onicecandidate = event=>{
    if (event.candidate) {
       socket.emit("candidate", id, event.candidate);
    }
  }
});


socket.on("answer", (id, description) => {
   //create a video element to hold the remote stream
   createRemoteVideoHTMLNode (id);

   allPeerConnections[id].setRemoteDescription(description)

  allPeerConnections[id].ontrack = event => {
    //remoteVideo html element
    const remoteVideoElement = document.getElementById(id);
    //set the remote stream as the video source
    remoteVideoElement.srcObject = event.streams[0];
  };
  allPeerConnections[id].onicecandidate = event => {

    if (event.candidate) {
      socket.emit("candidate", id, event.candidate);
    }
  };
});


socket.on("candidate", (id, candidate) => {
  allPeerConnections[id].addIceCandidate(new RTCIceCandidate(candidate));
});

//debug helper for server
socket.on('log', function(msg) {
  //receive console.log() server messages - debug feature
  console.log('FROM SERVER LOG: '+msg);
});

socket.on('bye',(id)=>{
  //when a client leaves a 'bye' is sent. remove their html video element and delete them from connections Obj
  let remoteVideoElement = document.getElementById(id);
  remoteVideoElement.remove();
  delete allPeerConnections[id];
});

socket.on('wrong',()=>{
  let room = document.getElementById('room');
  //let pass = document.getElementById('password');
  room.value = '';
  //pass.value = '';
});

socket.on('full',(room)=>{
  let rm = document.getElementById('room');
  //let pass = document.getElementById('password');
  rm.value = room +' is full';
  //pass.value = '';
});

window.addEventListener('beforeunload', function (e) {
  socket.emit('bye',room);
  // the absence of a returnValue property on the event will guarantee the browser unload happens
  delete e['returnValue'];
});

//error message handler
function learnFromMistakes(youFailed){
  console.log('so close, here is where it all went wrong:',youFailed)
}