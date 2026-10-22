// ---------------------------------------------------------------
// Home page robot: the team's real CAD assembly (assets/robot.glb),
// driven by scroll. Hardware (screws, nuts, spacers) is merged on
// the GPU so all 723 pieces can fly in and blow apart smoothly.
// Dimension lines and callouts are real values from the CAD file.
// ---------------------------------------------------------------
(function () {
  "use strict";

  var stage = document.getElementById("stage");
  var story = document.getElementById("story");
  var canvas = document.getElementById("robot-canvas");
  var svg = document.getElementById("annotations");
  var loaderEl = document.getElementById("loader");
  var loaderFill = document.getElementById("loader-fill");
  var loaderText = document.getElementById("loader-text");
  var cue = document.getElementById("scroll-cue");
  var beats = Array.prototype.slice.call(document.querySelectorAll(".beat"));
  if (!stage || !canvas) return;

  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var SVGNS = "http://www.w3.org/2000/svg";

  // ----- robot facts (model units; 1 unit = 0.1130 m) -----
  var H = 2.702, HX = 1.886, HZ = 2.0;
  var DIMS = { width: "16.8 in", length: "17.8 in", height: "12.0 in" };

  function failGracefully(msg) {
    stage.classList.add("no-webgl");
    loaderEl.classList.add("done");
    if (msg) console.warn(msg);
  }
  if (!window.THREE || !THREE.GLTFLoader || !window.MeshoptDecoder) { failGracefully("3D libraries did not load"); return; }

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (e) { failGracefully("WebGL unavailable"); return; }

  var small = Math.min(innerWidth, innerHeight) <= 760;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 1.75));
  renderer.setClearColor(0x000000, 0);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.physicallyCorrectLights = true;

  var scene = new THREE.Scene();
  var pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;

  var camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);

  var key = new THREE.DirectionalLight(0xffffff, 2.3); key.position.set(5, 8, 6); scene.add(key);
  var rim = new THREE.DirectionalLight(0x8fb4ff, 2.8); rim.position.set(-6, 4, -6); scene.add(rim);
  var kick = new THREE.DirectionalLight(0xff5560, 0.9); kick.position.set(6, 1, -5); scene.add(kick);

  var pivot = new THREE.Group(); scene.add(pivot);
  var robot = new THREE.Group(); robot.position.y = -H / 2; pivot.add(robot);

  // ----- blueprint floor: fine grid that fades out radially -----
  (function () {
    var S = 1024, c = document.createElement("canvas"); c.width = c.height = S;
    var g = c.getContext("2d");
    var cells = 32, step = S / cells;
    for (var i = 0; i <= cells; i++) {
      var major = i % 4 === 0;
      g.strokeStyle = major ? "rgba(140,175,230,0.55)" : "rgba(140,175,230,0.22)";
      g.lineWidth = major ? 2 : 1;
      g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, S); g.stroke();
      g.beginPath(); g.moveTo(0, i * step); g.lineTo(S, i * step); g.stroke();
    }
    g.globalCompositeOperation = "destination-in";
    var rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    rg.addColorStop(0, "rgba(0,0,0,1)"); rg.addColorStop(0.55, "rgba(0,0,0,0.6)"); rg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = rg; g.fillRect(0, 0, S, S);
    var tex = new THREE.CanvasTexture(c); tex.anisotropy = 8;
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.55 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.002; floor.material.opacity = 0.38; robot.add(floor);
    // soft contact shadow
    var s = document.createElement("canvas"); s.width = s.height = 256; var sg = s.getContext("2d");
    var gr = sg.createRadialGradient(128, 128, 4, 128, 128, 128);
    gr.addColorStop(0, "rgba(0,4,12,0.75)"); gr.addColorStop(0.55, "rgba(0,4,12,0.25)"); gr.addColorStop(1, "rgba(0,4,12,0)");
    sg.fillStyle = gr; sg.fillRect(0, 0, 256, 256);
    var shadow = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 6.2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(s), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.006; robot.add(shadow);
  })();

  // ----- keep the CAD colour, give it a believable finish -----
  function finish(src) {
    var c = (src && src.color ? src.color : new THREE.Color(1, 1, 1)).clone();
    var hsl = {}; c.getHSL(hsl);
    var m = new THREE.MeshStandardMaterial({ color: c });
    if (hsl.s > 0.35) { m.metalness = 0.35; m.roughness = 0.38; }       // coloured parts
    else if (hsl.l > 0.42) { m.metalness = 0.9; m.roughness = 0.32; }   // aluminium channel and plate
    else if (hsl.l > 0.12) { m.metalness = 0.55; m.roughness = 0.45; }  // darker metal
    else { m.metalness = 0.05; m.roughness = 0.62; }                     // rubber, plastic, motors
    return m;
  }

  // ----- hardware: merge all fasteners per material, animate on the GPU -----
  var hw = { uEx: { value: 0 }, uAng: { value: 0 } };
  var body = { uB: { value: 0 } };
  // per structural part: [offset x, y, z, start delay], planned from the CAD by subsystem
  // (hood lifts, shooter rises back, intake slides forward, corners/wheels/sides swing out, base stays)
  var PARTS = [[0.477,0.593,0.378,0.285],[1.25,0,1.0,0.215],[1.25,0,1.0,0.201],[-1.25,0,1.0,0.223],[-1.25,0,1.0,0.209],[0.657,-0.277,-0.462,0.283],[0.568,-0.433,-0.461,0.281],[0.392,-0.39,-0.645,0.271],[0,1.9,0.15,0.024],[-0.394,-0.467,-0.591,0.289],[0,0,0,0],[0.002,-0.087,-0.846,0.279],[0.623,-0.417,-0.401,0.288],[0,1.15,-0.75,0.086],[0,1.15,-0.75,0.109],[-0.834,-0.085,-0.141,0.277],[-0.748,-0.161,-0.37,0.32],[-0.676,-0.169,0.486,0.294],[-0.79,-0.086,0.302,0.3],[1.0,0,0,0.263],[-1.0,0,0,0.282],[-1.0,0,0,0.281],[-1.0,0,0,0.268],[-1.0,0,0,0.264],[-1.0,0,0,0.276],[-1.0,0,0,0.283],[-1.0,0,0,0.26],[0,1.15,-0.75,0.107],[0,1.15,-0.75,0.118],[0,1.15,-0.75,0.093],[0,1.15,-0.75,0.081],[0,1.15,-0.75,0.082],[0,1.15,-0.75,0.106],[0,1.15,-0.75,0.104],[0,1.15,-0.75,0.118],[0.719,0.235,-0.387,0.313],[0,1.15,-0.75,0.082],[0,1.15,-0.75,0.079],[0,1.15,-0.75,0.083],[0,1.15,-0.75,0.079],[0,1.15,-0.75,0.105],[0,1.15,-0.75,0.113],[0,1.15,-0.75,0.115],[0,1.15,-0.75,0.083],[0,1.15,-0.75,0.113],[0,1.15,-0.75,0.086],[0,1.15,-0.75,0.091],[0,1.15,-0.75,0.106],[0,1.15,-0.75,0.074],[0,1.15,-0.75,0.075],[0,1.15,-0.75,0.112],[0,1.15,-0.75,0.085],[0,1.15,-0.75,0.088],[0,1.15,-0.75,0.099],[0,1.15,-0.75,0.104],[0,1.15,-0.75,0.07],[0,1.15,-0.75,0.087],[0,0.25,-1.0,0.162],[0,0.25,-1.0,0.164],[-0.387,-0.304,-0.693,0.281],[0.386,-0.304,-0.693,0.299],[1.25,0,1.0,0.228],[1.25,0,1.0,0.2],[-1.25,0,1.0,0.207],[-1.25,0,1.0,0.186],[1.25,0,1.0,0.194],[1.25,0,1.0,0.213],[1.25,0,1.0,0.186],[1.25,0,1.0,0.224],[1.25,0,1.0,0.225],[1.25,0,1.0,0.185],[1.25,0,1.0,0.227],[1.25,0,1.0,0.199],[-1.25,0,1.0,0.219],[-1.25,0,1.0,0.218],[-1.25,0,1.0,0.195],[-1.25,0,1.0,0.214],[-1.25,0,1.0,0.213],[-1.25,0,1.0,0.22],[-1.25,0,1.0,0.193],[-1.25,0,1.0,0.218],[1.25,0,1.0,0.228],[1.25,0,1.0,0.214],[-1.25,0,1.0,0.207],[-1.25,0,1.0,0.186],[-1.25,0,1.0,0.205],[0,-0.05,1.7,0.128],[0,-0.05,1.7,0.146],[0,-0.05,1.7,0.144],[0,-0.05,1.7,0.138],[0,-0.05,1.7,0.119],[0,-0.05,1.7,0.142],[0,-0.05,1.7,0.142],[0,-0.05,1.7,0.119],[0,-0.05,1.7,0.154],[0,-0.05,1.7,0.143],[0,-0.05,1.7,0.116],[0,-0.05,1.7,0.157],[0,-0.05,1.7,0.117],[0,-0.05,1.7,0.127],[0,-0.05,1.7,0.146],[0,-0.05,1.7,0.14],[0,-0.05,1.7,0.138],[0,-0.05,1.7,0.142],[0,-0.05,1.7,0.133],[0,-0.05,1.7,0.126],[0,-0.05,1.7,0.119],[0,-0.05,1.7,0.113],[0,-0.05,1.7,0.146],[0,-0.05,1.7,0.148],[0,-0.05,1.7,0.137],[0.492,0.167,0.673,0.307],[0,-0.05,1.7,0.128],[0,-0.05,1.7,0.123],[0,-0.05,1.7,0.129],[0,-0.05,1.7,0.154],[0,-0.05,1.7,0.112],[0,-0.05,1.7,0.135],[0,-0.05,1.7,0.122],[0,-0.05,1.7,0.148],[0,-0.05,1.7,0.128],[0,-0.05,1.7,0.127],[0,-0.05,1.7,0.13],[1.0,0,0,0.267],[-1.0,0,0,0.279],[1.0,0,0,0.258],[-1.0,0,0,0.282],[0,-0.05,1.7,0.116],[1.7,0,0,0.214],[1.7,0,0,0.205],[1.7,0,0,0.206],[1.25,0,1.0,0.219],[1.0,0,0,0.276],[1.0,0,0,0.249],[1.0,0,0,0.249],[1.0,0,0,0.261],[1.0,0,0,0.277],[1.25,0,1.0,0.221],[1.25,0,1.0,0.217],[-1.7,0,0,0.23],[-1.7,0,0,0.207],[-1.7,0,0,0.22],[-1.25,0,1.0,0.19],[-1.0,0,0,0.266],[-1.0,0,0,0.268],[-1.0,0,0,0.25],[-1.0,0,0,0.253],[-1.0,0,0,0.279],[-1.25,0,1.0,0.182],[-1.25,0,1.0,0.22],[-1.7,0,0,0.245],[-1.7,0,0,0.247],[-1.7,0,0,0.219],[-1.7,0,0,0.228],[1.7,0,0,0.229],[1.7,0,0,0.232],[1.7,0,0,0.249],[1.7,0,0,0.234],[1.0,0,0,0.255],[1.0,0,0,0.283],[-1.0,0,0,0.264],[-1.0,0,0,0.27],[-1.0,0,0,0.276],[-1.0,0,0,0.24],[1.0,0,0,0.279],[1.0,0,0,0.273],[-0.266,-0.189,-0.785,0.295],[-0.145,-0.205,-0.812,0.296],[-0.063,-0.22,-0.819,0.293],[-0.268,-0.199,-0.782,0.28],[-0.318,-0.195,-0.764,0.296],[-1.0,0,0,0.242],[-0.432,-0.182,-0.709,0.295],[-0.381,-0.192,-0.735,0.302],[-0.349,-0.193,-0.751,0.292],[0.265,-0.209,-0.78,0.298],[0.145,-0.215,-0.809,0.318],[0.063,-0.205,-0.822,0.315],[0.267,-0.203,-0.781,0.277],[0.317,-0.199,-0.763,0.31],[1.0,0,0,0.271],[0.432,-0.182,-0.709,0.273],[0.382,-0.187,-0.736,0.288],[0.349,-0.193,-0.751,0.282],[1.0,0,0,0.244],[-1.0,0,0,0.267],[1.0,0,0,0.286],[1.0,0,0,0.256],[1.0,0,0,0.284],[1.0,0,0,0.275],[1.0,0,0,0.247],[1.0,0,0,0.283],[-1.0,0,0,0.27],[-1.0,0,0,0.286],[-1.0,0,0,0.276],[-1.0,0,0,0.277],[-1.0,0,0,0.257],[-1.0,0,0,0.28],[1.0,0,0,0.287],[1.0,0,0,0.283],[1.0,0,0,0.262],[-1.0,0,0,0.278],[-1.0,0,0,0.264],[-1.0,0,0,0.245],[1.0,0,0,0.242],[1.0,0,0,0.244],[-1.0,0,0,0.25],[-1.0,0,0,0.248],[0,0,0,0],[0,0,0,0],[0.57,-0.295,-0.558,0.295],[-0.571,-0.295,-0.556,0.305],[0.414,-0.173,-0.722,0.297],[-0.414,-0.171,-0.723,0.291],[-1.0,0,0,0.272],[1.0,0,0,0.255]];
  function readFloats(attr) {
    var inter = !!attr.isInterleavedBufferAttribute;
    var a = inter ? attr.data.array : attr.array;
    var n = attr.count, s = attr.itemSize, out = new Float32Array(n * s), div = 1, signed = true;
    if (attr.normalized) {
      if (a instanceof Int8Array) div = 127;
      else if (a instanceof Uint8Array) { div = 255; signed = false; }
      else if (a instanceof Int16Array) div = 32767;
      else if (a instanceof Uint16Array) { div = 65535; signed = false; }
    }
    for (var i = 0; i < n; i++) for (var k = 0; k < s; k++) {
      var v = inter ? a[i * attr.data.stride + attr.offset + k] : a[i * s + k];
      v /= div; if (attr.normalized && signed && v < -1) v = -1;
      out[i * s + k] = v;
    }
    return out;
  }
  function buildHardware(nodes) {
    var groups = {};
    robot.updateMatrixWorld(true);
    var inv = new THREE.Matrix4().copy(robot.matrixWorld).invert();
    var M = new THREE.Matrix4(), N = new THREE.Matrix3(), v = new THREE.Vector3();
    var centre = new THREE.Vector3(0, H * 0.45, 0);
    nodes.forEach(function (mesh) {
      var g = mesh.geometry;
      var pos = readFloats(g.attributes.position);
      var nor = g.attributes.normal ? readFloats(g.attributes.normal) : null;
      M.multiplyMatrices(inv, mesh.matrixWorld); N.getNormalMatrix(M);
      var n = g.attributes.position.count, p = new Float32Array(n * 3), no = new Float32Array(n * 3);
      var cx = 0, cy = 0, cz = 0;
      for (var i = 0; i < n; i++) {
        v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(M);
        p[i * 3] = v.x; p[i * 3 + 1] = v.y; p[i * 3 + 2] = v.z; cx += v.x; cy += v.y; cz += v.z;
        if (nor) { v.set(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]).applyMatrix3(N).normalize(); no[i * 3] = v.x; no[i * 3 + 1] = v.y; no[i * 3 + 2] = v.z; }
      }
      cx /= n; cy /= n; cz /= n;
      var dir = new THREE.Vector3(cx, cy, cz).sub(centre); dir.y *= 0.55;
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
      dir.normalize(); dir.y += 0.3; dir.normalize();
      var ax = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      var rnd = Math.random();
      var keyId = mesh.material.uuid;
      var G = groups[keyId] || (groups[keyId] = { mat: mesh.material, p: [], n: [], c: [], d: [], a: [], i: [], count: 0 });
      for (var j = 0; j < n; j++) { G.c.push(cx, cy, cz); G.d.push(dir.x, dir.y, dir.z); G.a.push(ax.x, ax.y, ax.z, rnd); }
      for (var q = 0; q < p.length; q++) { G.p.push(p[q]); G.n.push(no[q]); }
      if (g.index) { var idx = g.index.array; for (var w = 0; w < idx.length; w++) G.i.push(idx[w] + G.count); }
      else { for (var w2 = 0; w2 < n; w2++) G.i.push(w2 + G.count); }
      G.count += n;
      mesh.parent.remove(mesh);
    });
    Object.keys(groups).forEach(function (k) {
      var G = groups[k], geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(G.p, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(G.n, 3));
      geo.setAttribute("aCenter", new THREE.Float32BufferAttribute(G.c, 3));
      geo.setAttribute("aDir", new THREE.Float32BufferAttribute(G.d, 3));
      geo.setAttribute("aAxis", new THREE.Float32BufferAttribute(G.a, 4));
      geo.setIndex(G.count > 65535 ? new THREE.Uint32BufferAttribute(G.i, 1) : new THREE.Uint16BufferAttribute(G.i, 1));
      var mat = finish(G.mat);
      mat.onBeforeCompile = function (sh) {
        sh.uniforms.uEx = hw.uEx; sh.uniforms.uAng = hw.uAng;
        sh.vertexShader = sh.vertexShader
          .replace("#include <common>", "#include <common>\nuniform float uEx; uniform float uAng;\nattribute vec3 aCenter; attribute vec3 aDir; attribute vec4 aAxis;\nvec3 rotAx(vec3 v, vec3 k, float a){ float c=cos(a), s=sin(a); return v*c + cross(k,v)*s + k*dot(k,v)*(1.0-c); }")
          .replace("#include <beginnormal_vertex>", "float hwA = uAng*(0.6+aAxis.w*1.4);\nvec3 objectNormal = rotAx(vec3(normal), aAxis.xyz, hwA);\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif")
          .replace("#include <begin_vertex>", "vec3 transformed = rotAx(position-aCenter, aAxis.xyz, hwA) + aCenter + aDir*uEx*(0.65+aAxis.w*0.9);");
      };
      var mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; robot.add(mesh);
    });
  }

  function buildBody(list) {
    var groups = {};
    robot.updateMatrixWorld(true);
    var inv = new THREE.Matrix4().copy(robot.matrixWorld).invert();
    var M = new THREE.Matrix4(), N = new THREE.Matrix3(), v = new THREE.Vector3();
    list.forEach(function (it) {
      var g = it.mesh.geometry, k = it.mesh.material.uuid;
      var G = groups[k] || (groups[k] = { mat: it.mesh.material, items: [], verts: 0, idx: 0 });
      G.items.push(it); G.verts += g.attributes.position.count; G.idx += g.index ? g.index.count : g.attributes.position.count;
    });
    Object.keys(groups).forEach(function (k) {
      var G = groups[k];
      var P = new Float32Array(G.verts * 3), Nn = new Float32Array(G.verts * 3), O = new Float32Array(G.verts * 3), D = new Float32Array(G.verts);
      var I = G.verts > 65535 ? new Uint32Array(G.idx) : new Uint16Array(G.idx);
      var vo = 0, io = 0;
      G.items.forEach(function (it) {
        var mesh = it.mesh, g = mesh.geometry, plan = PARTS[it.i] || [0, 0, 0, 0];
        var pos = readFloats(g.attributes.position), nor = g.attributes.normal ? readFloats(g.attributes.normal) : null;
        M.multiplyMatrices(inv, mesh.matrixWorld); N.getNormalMatrix(M);
        var n = g.attributes.position.count;
        for (var j = 0; j < n; j++) {
          var b = (vo + j) * 3;
          v.set(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]).applyMatrix4(M); P[b] = v.x; P[b + 1] = v.y; P[b + 2] = v.z;
          if (nor) { v.set(nor[j * 3], nor[j * 3 + 1], nor[j * 3 + 2]).applyMatrix3(N).normalize(); Nn[b] = v.x; Nn[b + 1] = v.y; Nn[b + 2] = v.z; }
          O[b] = plan[0]; O[b + 1] = plan[1]; O[b + 2] = plan[2]; D[vo + j] = plan[3];
        }
        if (g.index) { var src = g.index.array; for (var w = 0; w < src.length; w++) I[io++] = src[w] + vo; }
        else { for (var w2 = 0; w2 < n; w2++) I[io++] = w2 + vo; }
        vo += n;
        mesh.parent.remove(mesh);
      });
      var geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(P, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(Nn, 3));
      geo.setAttribute("aOff", new THREE.BufferAttribute(O, 3));
      geo.setAttribute("aDelay", new THREE.BufferAttribute(D, 1));
      geo.setIndex(new THREE.BufferAttribute(I, 1));
      var mat = finish(G.mat);
      mat.onBeforeCompile = function (sh) {
        sh.uniforms.uB = body.uB;
        sh.vertexShader = sh.vertexShader
          .replace("#include <common>", "#include <common>\nuniform float uB; attribute vec3 aOff; attribute float aDelay;")
          .replace("#include <begin_vertex>", "vec3 transformed = position + aOff * smoothstep(aDelay, aDelay + 0.5, uB);");
      };
      var m = new THREE.Mesh(geo, mat); m.frustumCulled = false; robot.add(m);
    });
  }

  // ----- load the CAD model -----
  var ready = false, readyAt = 0;
  function setProgress(f) { loaderFill.style.width = Math.round(f * 100) + "%"; }
  function parseModel(buffer) {
    loaderText.textContent = "ASSEMBLING";
    var gl = new THREE.GLTFLoader();
    gl.setMeshoptDecoder(MeshoptDecoder);
    gl.parse(buffer, "", function (gltf) {
      robot.add(gltf.scene);
      robot.updateMatrixWorld(true);
      var hwNodes = [], partNodes = [];
      gltf.scene.traverse(function (o) {
        if (!o.isMesh) return;
        var nm = "|" + (o.name || "") + "|" + ((o.parent && o.parent.name) || "") + "|";
        var pm = nm.match(/\|p_(\d+)/);
        if (nm.indexOf("|hw_") >= 0) hwNodes.push(o);
        else if (pm) partNodes.push({ mesh: o, i: +pm[1] });
        else o.material = finish(o.material);
      });
      buildBody(partNodes);
      buildHardware(hwNodes);
      ready = true; readyAt = performance.now();
      loaderEl.classList.add("done");
      kick_();
    }, function (err) { failGracefully(err); });
  }
  function load() {
    if (window.ROBOT_GLB_B64) {
      setTimeout(function () {
        var bin = atob(window.ROBOT_GLB_B64), u = new Uint8Array(bin.length);
        for (var k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
        window.ROBOT_GLB_B64 = null; setProgress(1); parseModel(u.buffer);
      }, 40);
      return;
    }
    // Opened by double-clicking index.html (file://): browsers block fetch() there,
    // so load the same model from a script file instead, which is allowed.
    if (location.protocol === "file:") {
      loaderText.textContent = "LOADING ROBOT CAD";
      var sc = document.createElement("script");
      sc.src = "assets/robot-data.js";
      sc.onload = function () { if (window.ROBOT_GLB_B64) load(); else failGracefully("robot-data.js loaded but was empty"); };
      sc.onerror = function () { failGracefully("Could not load assets/robot-data.js"); };
      document.body.appendChild(sc);
      return;
    }
    fetch("assets/robot.glb").then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      var total = +res.headers.get("Content-Length") || 0;
      if (!res.body || !total) return res.arrayBuffer();
      var reader = res.body.getReader(), got = 0, chunks = [];
      return (function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            var out = new Uint8Array(got), off = 0;
            chunks.forEach(function (c) { out.set(c, off); off += c.length; });
            return out.buffer;
          }
          chunks.push(r.value); got += r.value.length; setProgress(got / total);
          return pump();
        });
      })();
    }).then(parseModel).catch(function (e) { failGracefully(e); });
  }
  load();

  // ----- scroll choreography -----
  function cl(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function ss(a, b, x) { x = cl((x - a) / (b - a)); return x * x * (3 - 2 * x); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  // camera/robot poses at points along the story (p = 0..1)
  var KEYS = [
    { p: 0.00, rot: -0.70, x: 1.40, z: 10.4 },
    { p: 0.12, rot: -0.70, x: 1.40, z: 10.4 },
    { p: 0.30, rot: -0.95, x: -1.25, z: 11.2 },
    { p: 0.38, rot: -0.95, x: -1.25, z: 11.2 },
    { p: 0.56, rot: 0.55, x: 1.75, z: 14.2 },
    { p: 0.64, rot: 0.70, x: 1.75, z: 14.2 },
    { p: 0.82, rot: -1.85, x: -1.05, z: 11.0 },
    { p: 1.00, rot: -1.95, x: -1.05, z: 11.0 }
  ];
  function pose(p) {
    for (var i = 0; i < KEYS.length - 1; i++) {
      var a = KEYS[i], b = KEYS[i + 1];
      if (p <= b.p) { var t = ss(a.p, b.p, p); return { rot: lerp(a.rot, b.rot, t), x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t) }; }
    }
    var l = KEYS[KEYS.length - 1]; return { rot: l.rot, x: l.x, z: l.z };
  }
  var BEATS = [[-1, 0.15], [0.17, 0.42], [0.44, 0.68], [0.70, 2]];

  function storyProgress() {
    var r = story.getBoundingClientRect();
    var span = r.height - innerHeight;
    return span > 0 ? cl(-r.top / span) : 0;
  }

  // ----- SVG annotations projected from the 3D model -----
  var V = new THREE.Vector3();
  var W = 1, Hs = 1;
  function proj(x, y, z) {
    V.set(x, y, z).applyMatrix4(robot.matrixWorld).project(camera);
    return { x: (V.x * 0.5 + 0.5) * W, y: (-V.y * 0.5 + 0.5) * Hs };
  }
  function el(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    (parent || svg).appendChild(e); return e;
  }
  // dimension line between two robot-space points, with extension lines from the part edges
  var OFF = 0.5;
  var DIMLINES = [
    { label: DIMS.width,  a: [-HX, 0, HZ + OFF],  b: [HX, 0, HZ + OFF],   ea: [-HX, 0, HZ], eb: [HX, 0, HZ] },
    { label: DIMS.length, a: [HX + OFF, 0, HZ],   b: [HX + OFF, 0, -HZ],  ea: [HX, 0, HZ],  eb: [HX, 0, -HZ] },
    { label: DIMS.height, a: [HX + OFF, 0, -HZ],  b: [HX + OFF, H, -HZ],  ea: [HX, 0, -HZ], eb: [HX, H, -HZ] }
  ];
  var CALLOUTS = [
    { at: [0, 1.49, -0.65], dx: -210, dy: -150, title: "Shooter", sub: "96 MM FLYWHEEL · ANGLED HOOD" },
    { at: [0, 0.40, 1.05],  dx: -190, dy: 120,  title: "Intake", sub: "FULL-WIDTH FRONT INTAKE" },
    { at: [HX - 0.1, 0.43, -0.3], dx: 170, dy: 150, title: "Six-wheel drive", sub: "6 × 96 MM WHEELS" }
  ];
  var dimLayer = el("g", {}), callLayer = el("g", {});
  var dimEls = DIMLINES.map(function (d) {
    return {
      e1: el("line", { "class": "ext" }, dimLayer), e2: el("line", { "class": "ext" }, dimLayer),
      line: el("line", { "class": "dim" }, dimLayer),
      t1: el("line", { "class": "dim" }, dimLayer), t2: el("line", { "class": "dim" }, dimLayer),
      bg: el("rect", { "class": "dim-label-bg", rx: 3 }, dimLayer),
      text: el("text", { "class": "dim-label", "text-anchor": "middle", "dominant-baseline": "central" }, dimLayer)
    };
  });
  dimEls.forEach(function (d, i) { d.text.textContent = DIMLINES[i].label; });
  var callEls = CALLOUTS.map(function (c) {
    var g = el("g", {}, callLayer);
    var o = {
      g: g, lead: el("polyline", { "class": "lead" }, g),
      dot: el("circle", { "class": "node", r: 4.5 }, g),
      title: el("text", { "class": "call-title" }, g),
      sub: el("text", { "class": "call-sub" }, g)
    };
    o.title.textContent = c.title; o.sub.textContent = c.sub; return o;
  });
  function setLine(l, a, b) { l.setAttribute("x1", a.x); l.setAttribute("y1", a.y); l.setAttribute("x2", b.x); l.setAttribute("y2", b.y); }
  function drawAnnotations(dimA, callA) {
    dimLayer.style.opacity = dimA > 0.001 ? 1 : 0;
    if (dimA > 0.001) {
      DIMLINES.forEach(function (d, i) {
        var e = dimEls[i];
        var grow = ss(i * 0.18, i * 0.18 + 0.64, dimA);
        var A = proj(d.a[0], d.a[1], d.a[2]), B = proj(d.b[0], d.b[1], d.b[2]);
        var EA = proj(d.ea[0], d.ea[1], d.ea[2]), EB = proj(d.eb[0], d.eb[1], d.eb[2]);
        var mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
        var a2 = { x: lerp(mid.x, A.x, grow), y: lerp(mid.y, A.y, grow) }, b2 = { x: lerp(mid.x, B.x, grow), y: lerp(mid.y, B.y, grow) };
        setLine(e.line, a2, b2);
        // extension lines run a little past the dimension line
        function extend(P, Q) { var dx = Q.x - P.x, dy = Q.y - P.y, L = Math.hypot(dx, dy) || 1; return { x: Q.x + dx / L * 8, y: Q.y + dy / L * 8 }; }
        setLine(e.e1, EA, extend(EA, A)); setLine(e.e2, EB, extend(EB, B));
        e.e1.style.opacity = e.e2.style.opacity = grow;
        // architectural tick marks at each end
        var ux = B.x - A.x, uy = B.y - A.y, L = Math.hypot(ux, uy) || 1; ux /= L; uy /= L;
        var tx = (ux - uy) * 6, ty = (uy + ux) * 6;
        setLine(e.t1, { x: a2.x - tx, y: a2.y - ty }, { x: a2.x + tx, y: a2.y + ty });
        setLine(e.t2, { x: b2.x - tx, y: b2.y - ty }, { x: b2.x + tx, y: b2.y + ty });
        e.t1.style.opacity = e.t2.style.opacity = grow > 0.98 ? 1 : 0;
        var tA = ss(0.6, 1, grow);
        e.text.setAttribute("x", mid.x); e.text.setAttribute("y", mid.y);
        e.text.style.opacity = e.bg.style.opacity = tA;
        var tw = e.text.getComputedTextLength ? e.text.getComputedTextLength() : 56;
        e.bg.setAttribute("x", mid.x - tw / 2 - 7); e.bg.setAttribute("y", mid.y - 11);
        e.bg.setAttribute("width", tw + 14); e.bg.setAttribute("height", 22);
      });
    }
    callLayer.style.opacity = callA > 0.001 ? 1 : 0;
    if (callA > 0.001) {
      var scale = W < 760 ? 0.5 : 1;
      CALLOUTS.forEach(function (c, i) {
        var o = callEls[i];
        var a = ss(i * 0.2, i * 0.2 + 0.6, callA);
        var P = proj(c.at[0], c.at[1], c.at[2]);
        var dx = c.dx * scale, dy = c.dy * scale;
        var elbow = { x: P.x + dx * 0.55, y: P.y + dy };
        var end = { x: P.x + dx, y: P.y + dy };
        // keep labels on screen
        var pad = 16;
        if (end.x < pad + 10) { end.x = pad + 10; }
        if (end.x > W - pad - 10) { end.x = W - pad - 10; }
        var len = a;
        var e1 = { x: lerp(P.x, elbow.x, cl(len * 2)), y: lerp(P.y, elbow.y, cl(len * 2)) };
        var e2 = { x: lerp(elbow.x, end.x, cl(len * 2 - 1)), y: elbow.y };
        o.lead.setAttribute("points", P.x + "," + P.y + " " + e1.x + "," + e1.y + (len > 0.5 ? " " + e2.x + "," + e2.y : ""));
        o.dot.setAttribute("cx", P.x); o.dot.setAttribute("cy", P.y);
        var right = dx >= 0;
        var tx = right ? Math.min(elbow.x, end.x) : Math.max(elbow.x, end.x);
        var tw = Math.max(o.sub.getComputedTextLength ? o.sub.getComputedTextLength() : 0, o.title.getComputedTextLength ? o.title.getComputedTextLength() : 0);
        if (right && tx + tw > W - 12) tx = W - 12 - tw;
        if (!right && tx - tw < 12) tx = 12 + tw;
        o.title.setAttribute("text-anchor", right ? "start" : "end");
        o.sub.setAttribute("text-anchor", right ? "start" : "end");
        o.title.setAttribute("x", tx); o.title.setAttribute("y", elbow.y - 10);
        o.sub.setAttribute("x", tx); o.sub.setAttribute("y", elbow.y + 19);
        o.g.style.opacity = a;
        o.title.style.opacity = o.sub.style.opacity = ss(0.55, 1, a);
      });
    }
  }

  // ----- sizing -----
  function resize() {
    W = stage.clientWidth; Hs = stage.clientHeight;
    small = Math.min(W, Hs) <= 760 || W < 760;
    renderer.setSize(W, Hs, false);
    camera.aspect = W / Hs; camera.updateProjectionMatrix();
    svg.setAttribute("viewBox", "0 0 " + W + " " + Hs);
    kick_();
  }
  addEventListener("resize", resize);

  // ----- pointer parallax (desktop only) -----
  var mx = 0, my = 0, tmx = 0, tmy = 0;
  addEventListener("pointermove", function (e) {
    if (e.pointerType !== "mouse") return;
    tmx = e.clientX / innerWidth - 0.5; tmy = e.clientY / innerHeight - 0.5; kick_();
  });

  // ----- render loop: only while the home story is on screen -----
  var visible = true, homeShown = true, running = false, smooth = -1, t0 = performance.now(), active = -1;
  new IntersectionObserver(function (es) { visible = es[0].isIntersecting; kick_(); }, { threshold: 0 }).observe(story);
  document.addEventListener("pagechange", function (e) { homeShown = e.detail === "home"; if (homeShown) { resize(); } kick_(); });
  addEventListener("scroll", kick_, { passive: true });
  document.addEventListener("visibilitychange", kick_);

  function kick_() { if (!running && visible && homeShown && !document.hidden) { running = true; requestAnimationFrame(frame); } }

  function frame(now) {
    if (!(visible && homeShown && !document.hidden)) { running = false; return; }
    var t = (now - t0) / 1000;
    var target = storyProgress();
    if (smooth < 0) smooth = target;
    smooth += (target - smooth) * (reduce ? 1 : 0.09);
    mx += (tmx - mx) * 0.05; my += (tmy - my) * 0.05;
    var p = smooth;

    // text beats
    var b = -1;
    for (var i = 0; i < BEATS.length; i++) if (p >= BEATS[i][0] && p < BEATS[i][1]) b = i;
    if (b !== active) { active = b; beats.forEach(function (el, k) { el.classList.toggle("on", k === b); }); }
    if (cue) cue.style.opacity = p > 0.02 ? 0 : 1;

    // pose
    var P = pose(p);
    var idle = reduce ? 0 : Math.sin(t * 0.35) * 0.06 * (1 - ss(0.1, 0.2, p));
    pivot.rotation.y = P.rot + idle + mx * 0.35;
    pivot.rotation.x = 0.04 + my * 0.1;
    var aspectFit = Math.min(1, (W / Hs) / 1.6);
    if (small) {
      // phones: robot sits under the headline in the hero, above the text in later beats
      var heroW = 1 - ss(0.10, 0.22, p);
      var portrait = Hs > W;
      var dimW = cl(ss(0.17, 0.25, p) - ss(0.38, 0.46, p));
      pivot.position.set(-0.45 * dimW, lerp(1.45, portrait ? -2.75 : -0.9, heroW), 0);
      camera.position.set(0, 1.1, P.z * (portrait ? 1.9 + 0.2 * heroW : 1.4));
      camera.lookAt(0, 0.85, 0);
    } else {
      pivot.position.set(P.x * aspectFit * 1.7, -0.25, 0);
      camera.position.set(mx * 0.4, 1.0 + my * 0.3, P.z);
      camera.lookAt(0, -0.1, 0);
    }

    // hardware: fly in on load, blow apart in the exploded-view beat
    var exIn = ss(0.42, 0.57, p), exOut = ss(0.62, 0.72, p);
    var ex = cl(exIn - exOut);
    body.uB.value = ex;                                   // structural parts, staggered per subsystem
    var hwEx = cl(ss(0.35, 1, exIn) - exOut);             // screws go last
    var intro = 0;
    if (ready && !reduce) intro = 1 - ss(0, 1, (now - readyAt) / 2200);
    var amt = Math.max(hwEx * 2.6, intro * 3.4);
    hw.uEx.value = amt;
    hw.uAng.value = amt * 2.2 + (amt > 0.001 && !reduce ? t * 0.9 * Math.min(1, amt) : 0);

    renderer.render(scene, camera);
    robot.updateMatrixWorld(true);

    var dimA = ready ? cl(ss(0.20, 0.32, p) - ss(0.40, 0.45, p)) : 0;
    var callA = ready ? ss(0.72, 0.84, p) : 0;
    drawAnnotations(dimA, callA);

    // keep animating while anything is still settling
    var settling = Math.abs(target - smooth) > 0.0005 || Math.abs(tmx - mx) > 0.001 || Math.abs(tmy - my) > 0.001 ||
      (ready && intro > 0) || amt > 0.001 || (!reduce && p < 0.2) || !ready;
    if (settling) requestAnimationFrame(frame); else running = false;
  }

  resize();
  kick_();
})();
