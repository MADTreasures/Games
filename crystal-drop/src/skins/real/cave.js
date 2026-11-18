// Crystal Drop – realistic skin: photographic cave rooms with motion registered to each photograph
// (water, light, glints) and a slow drift of dust. One room per level, crossfaded on a level change.
// The room photographs live in assets/caves/ (see caves.json); build.mjs embeds them as #cave-art.
// Modules: KF.Water (WebGL), KF.WaterFallback, KF.MineralMotion, KF.CavernMotion, KF.Atmosphere, KF.Cave.
// ---- src/water.js — three-dimensional water registered to the grotto photograph.
(function (KF) {
  'use strict';
  const geometry = {"imageSize":[1122,1402],"lip":[[0.867,0.323],[0.897,0.315],[0.927,0.305]],"inlet":[[0.947,0.286],[0.934,0.295],[0.917,0.303],[0.897,0.315]],"fallCenterline":[[0.897,0.315],[0.877,0.351],[0.854,0.406],[0.836,0.485],[0.822,0.586],[0.811,0.677],[0.806,0.764]],"impact":[0.806,0.764],"basin":[[0.413,0.704],[0.438,0.698],[0.509,0.698],[0.544,0.705],[0.552,0.72],[0.552,0.733],[0.578,0.744],[0.618,0.747],[0.69,0.75],[0.741,0.754],[0.804,0.758],[0.853,0.764],[0.905,0.771],[0.909,0.793],[0.91,0.823],[0.899,0.837],[0.859,0.851],[0.829,0.867],[0.817,0.881],[0.809,0.9],[0.81,0.922],[0.824,0.937],[0.845,0.941],[0.826,0.961],[0.808,0.978],[0.789,1],[0.5,1],[0.491,0.983],[0.481,0.971],[0.448,0.967],[0.407,0.969],[0.371,0.976],[0.327,0.985],[0.306,0.992],[0.286,0.996],[0.245,0.98],[0.225,0.97],[0.245,0.959],[0.251,0.945],[0.239,0.931],[0.212,0.919],[0.193,0.904],[0.163,0.887],[0.147,0.878],[0.164,0.872],[0.159,0.858],[0.142,0.845],[0.126,0.839],[0.136,0.833],[0.188,0.83],[0.211,0.819],[0.203,0.804],[0.255,0.797],[0.27,0.786],[0.282,0.777],[0.275,0.765],[0.266,0.759],[0.294,0.758],[0.301,0.753],[0.322,0.751],[0.337,0.75],[0.358,0.746],[0.379,0.74],[0.403,0.739],[0.398,0.731],[0.376,0.724],[0.371,0.719],[0.399,0.714]]};
  const aspect = geometry.imageSize[0] / geometry.imageSize[1];
  const horizon = .549, eye = .58, focal = .88;
  const poolDepth = v => eye * focal / (v - horizon);
  const unproject = (u, v, z) => [(u - .5)*aspect*z/focal, eye - (v - horizon)*z/focal, z];
  const impact = unproject(geometry.impact[0], geometry.impact[1], poolDepth(geometry.impact[1]));
  const projection = `
    const float focal = ${focal.toFixed(5)}, aspect = ${aspect.toFixed(7)}, horizon = ${horizon.toFixed(5)}, eye = ${eye.toFixed(5)};
    const vec2 impact = vec2(${impact[0].toFixed(7)}, ${impact[2].toFixed(7)});
    vec2 photoUV(vec3 p) { return vec2(.5 + focal * p.x / (aspect*p.z), horizon - focal*(p.y-eye)/p.z); }
    vec4 project(vec3 p) {
      vec2 uv = photoUV(p);
      return vec4((uv.x*2.-1.)*p.z,(1.-2.*uv.y)*p.z,p.z*.95-.19,p.z);
    }
  `;
  const waveCode = `
    float heightAt(vec2 p,float t) {
      float r=length(p-impact);
      return .0017*sin(dot(p,vec2(6.4,18.8))-1.8*t) + .0010*sin(dot(p,vec2(-9.2,29.))+2.5*t)
             + .0023*exp(-1.7*r)*sin(45.*r-t*5.1);
    }
  `;
  const vertex = `
    precision highp float;
    attribute vec3 aPosition; attribute vec3 aSurface;
    uniform float uTime,uKind,uPixelRatio;
    varying vec3 pos, surf; varying float opacity;
    ${projection}
    ${waveCode}
    void main(){
      vec3 p=aPosition; surf=aSurface; opacity=1.;
      if(uKind<.5){
        p.y+=heightAt(p.xz,uTime);
      }else if(uKind<1.5){
        float f=surf.y, s=surf.x, flow=sqrt(max(.0001,f+.015))-.64*uTime;
        float flutter=sin(flow*16.5+surf.z*2.9+s*6.)+.47*sin(flow*39.+s*11.+surf.z*3.);
        p.x+=.0075*flutter*smoothstep(.0,.14,f)*(.35+.65*f);
        p.z+=.013*(sin(14.*s+flow*6.2)+.5*cos(33.*s-flow*10.))*smoothstep(.0,.12,f);
      }else if(uKind>2.5){
        // Gravity stretches droplets into thinner, faster rivulets below the crest.
        float age=fract(aPosition.x+uTime/(.84+.27*surf.z));
        float f=age*age;
        float v=mix(.315,.764,f), spread=.045+.081*f;
        float u=.806+.091*pow(1.-f,3.7)+spread*(aPosition.y-.48)+
                .0045*sin(f*9.+aPosition.z*6.)*f;
        float z=impact.y+.48*(1.-pow(f,.67))-.06*(surf.x+.3)*f;
        p=vec3((u-.5)*aspect*z/focal, eye-(v-horizon)*z/focal,z);
        opacity=(.09+.31*surf.x)*smoothstep(.03,.27,f)*smoothstep(.0,.09,1.-f);
        gl_PointSize=clamp(uPixelRatio*(1.35+1.5*surf.y),1.,5.);
      }else{
        float lifetime=.19+.42*surf.z, cycle=uTime/lifetime+aPosition.x;
        float age=fract(cycle), seed=floor(cycle);
        float a=6.28318*fract(aPosition.y+seed*.381966);
        float salt=fract(aPosition.z+seed*.2361);
        float speed=.12+.43*salt;
        float t=age*lifetime;
        p=vec3(impact.x+.15*(surf.x-.5)+cos(a)*speed*t, .004+(.42+.77*salt)*t-2.35*t*t,
               impact.y+.035*(surf.y-.5)+sin(a)*speed*t);
        opacity=(1.-smoothstep(.25,1.,age))*(.32+.67*salt)*smoothstep(-.003,.012,p.y);
        gl_PointSize=clamp(uPixelRatio*(1.2+1.43*fract(surf.x*14.3))*(1.-.38*age),1.,6.);
      }
      pos=p;
      gl_Position=project(p);
    }
  `;
  const fragment = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    uniform sampler2D uPhoto,uNoise,uBank;
    uniform float uTime,uKind;
    varying vec3 pos,surf; varying float opacity;
    ${projection}
    vec3 photograph(vec2 uv){return texture2D(uPhoto,clamp(uv,.001,.999)).rgb;}
    float luma(vec3 c){return dot(c,vec3(.22,.69,.09));}
    void main(){
      vec2 uv=photoUV(pos); float t=uTime;
      if(uKind<.5){
        float mask=texture2D(uBank,surf.xy).r;
        if(mask<.015)discard;
        vec2 p=pos.xz,d=p-impact;
        float r=max(length(d),.004), pulse=47.*r-t*5.1;
        float shear=texture2D(uNoise,p*.034+vec2(.0008*t,.002*t)).r;
        float crosswind=texture2D(uNoise,p*.019-vec2(.0006*t,.0002*t)).b;
        vec2 slope=vec2(6.4,18.8)*.00065*cos(dot(p,vec2(6.4,18.8))-1.8*t+4.1*shear+2.3*crosswind)
                  +vec2(-9.2,29.)*.00047*cos(dot(p,vec2(-9.2,29.))+2.5*t+1.6*shear)
                  +d/r*.079*exp(-4.1*r)*cos(pulse+.86*shear);
        // Short capillary waves break the reflected rock into moving slivers.
        vec2 grain=texture2D(uNoise,p*vec2(.08,.16)+vec2(t*.008,-t*.013)).rg-.5;
        slope += grain*vec2(.058,.12);
        slope += (.4+.6*crosswind)*vec2(.008,.026)*sin(dot(p,vec2(19.,83.))+t*3.3+8.*shear);
        slope += (.3+.7*shear)*vec2(-.020,.014)*cos(dot(p,vec2(-37.,32.))-.8*t+8.*crosswind);
        vec3 N=normalize(vec3(-slope.x,1.,-slope.y));
        vec3 V=normalize(vec3(0.,eye,0.)-pos);
        vec3 R=reflect(-V,N);
        vec2 refl=vec2(.5+focal*R.x/(aspect*R.z),horizon-focal*R.y/R.z);
        vec3 reflected=photograph(refl);
        float fres=.135+.61*pow(1.-max(dot(V,N),0.),3.6);
        vec3 bed=photograph(uv+vec2(slope.x,-slope.y)*.018);
        float shallows=smoothstep(.76,1.015,uv.y);
        vec3 transmission=vec3(.010,.105,.095) + bed*mix(vec3(.13,.31,.24),vec3(.44,.64,.45),shallows);
        float caustic=pow(max(.0,1.-abs(sin(p.x*47.+sin(p.y*31.+t))*.64+sin(p.y*42.-t)*.73)),13.);
        transmission+=vec3(.014,.030,.018)*caustic*shallows;
        vec3 colour=mix(transmission,reflected*vec3(.78,.96,.88),fres);
        float glint=pow(max(0.,dot(R,normalize(vec3(-.09,.55,1.)))),265.);
        colour+=vec3(.57,.75,.61)*glint*(.005+.065*shear*crosswind);
        // Aerated contact patch with irregular outer foam and propagating rings.
        vec2 buoy=d/vec2(.153,.115);
        float bubble=texture2D(uNoise,p*.38+vec2(t*.018,-t*.012)).b;
        float foam=exp(-dot(buoy,buoy)*.61)*(.40+.65*bubble);
        float halo=exp(-abs(length(buoy)-1.4)*3.2)*max(0.,.47+.52*sin(pulse))*bubble;
        colour=mix(colour,vec3(.81,.90,.89),clamp(1.12*foam+halo*.46,0.,.99));
        gl_FragColor=vec4(colour,mask*.984);
      }else if(uKind<1.5){
        float x=surf.x,y=surf.y,layer=surf.z;
        float flow=sqrt(.019+y)-t*.66;
        float bend=.027*sin(flow*21.+layer*2.7)+.018*cos(flow*47.+x*6.);
        float across=x+bend*(.44+smoothstep(.02,.5,y));
        vec4 band=texture2D(uNoise,vec2(across*.064+layer*.273,flow*.087+layer*.31));
        vec4 twine=texture2D(uNoise,vec2(across*.228+band.b*.024,flow*.19+layer*.54));
        vec4 silk=texture2D(uNoise,vec2(across*.68+twine.g*.023,flow*.43+layer*.81));
        float head=.37+.09*sin(flow*8.4)+.08*band.b-.11*y;
        float branch=.72+.055*sin(flow*11.)+.035*band.r;
        float core=exp(-pow((across-head)/(.134+.10*(1.-y)),2.));
        float narrow=exp(-pow((across-branch)/(.028+.023*band.b),2.));
        float broken=smoothstep(.20,.84,twine.g*.72+silk.r*.28);
        float folded=pow(max(.0,1.-abs(twine.r*2.-1.)),3.0)*(.25+.75*silk.g);
        float filaments=smoothstep(.50,.95,twine.b*.65+silk.g*.35)*smoothstep(.03,.2,y);
        float airy=core*(.38+.91*broken)+narrow*(.37+.66*twine.b)+filaments*.30;
        float fizz=smoothstep(.65,.87,silk.b*.68+twine.r*.32)*(.28+.72*y);
        float rim=smoothstep(.0,.105+.08*band.b,min(x,1.-x));
        float alpha=rim*clamp(.027+airy*(.29+.85*broken)+folded*(.16+.43*core)+fizz*.35,.0,.98);
        if(layer>.5){
          alpha*=.10+.38*broken*band.g;
        }
        alpha*=smoothstep(.0,.012,y);
        vec3 stone=photograph(uv+vec2(twine.g-.5,band.g-.5)*vec2(.009,.003));
        vec3 water=mix(stone*.81+vec3(.013,.067,.072),vec3(.84,.91,.96),
                       clamp(.10+core*.48+narrow*.46+broken*.22+folded*.65+fizz*.70,0.,1.));
        if(alpha<.013)discard;
        gl_FragColor=vec4(water,alpha);
      }else{
        vec2 s=(gl_PointCoord-.5)*2.;
        if(uKind>2.5)s.x*=1.8;
        float amount=opacity*(1.-smoothstep(.1,1.,dot(s,s)));
        if(amount<.013)discard;
        gl_FragColor=vec4(.77,.85,.83,amount);
      }
    }
  `;

  function makeGeometry() {
    const vertices=[], indices=[];
    function grid(nx,ny,point) {
      const start=vertices.length/6;
      for(let j=0;j<=ny;j++) for(let i=0;i<=nx;i++) vertices.push(...point(i/nx,j/ny));
      for(let j=0;j<ny;j++) for(let i=0;i<nx;i++) {
        const a=start+j*(nx+1)+i,b=a+nx+1;
        indices.push(a,b,a+1,a+1,b,b+1);
      }
    }
    grid(46,52,(s,t)=>{
      const u=.11+.81*s,v=.694+.316*t;
      return [...unproject(u,v,poolDepth(v)),u,v,0];
    });
    const poolCount=indices.length;
    const path=geometry.fallCenterline, first=path[0], last=path[path.length-1];
    function centerX(v) {
      let i=1;
      while(i<path.length-1 && path[i][1]<v)i++;
      const a=path[i-1], b=path[i], f=(v-a[1])/(b[1]-a[1]);
      return a[0]+f*(b[0]-a[0]);
    }
    for (let layer=0;layer<7;layer++) {
      grid(layer===0?38:5,76,(s,t)=>{
        const v=first[1]+(last[1]-first[1])*t;
        const lanes=[0,-.51,-.29,.02,.19,.37,.52];
        const cross=layer===0?s-.5:lanes[layer]+(s-.5)*(.12+.065*Math.sin(layer*3.1))+
          (.055+.036*Math.sin(layer*2.9))*Math.sin(t*5.+layer)*Math.sin(t*Math.PI);
        const width=.061+.028*Math.pow(t,.55);
        const u=centerX(v)+cross*width+.0028*Math.sin(t*7.2+layer)*Math.sin(Math.PI*t);
        const vv=v-.018*cross*(1.-t);
        const z=impact[2]+.46*(1.-Math.pow(t,.67))-.024*layer*Math.sin(t*Math.PI);
        return [...unproject(u,vv,z),s,t,layer];
      });
    }
    // Water on the inclined rock sill joins the vertical sheet at its upstream edge.
    grid(14,18,(s,t)=>{
      const p=geometry.inlet, along=t*(p.length-1);
      const i=Math.min(p.length-2,Math.floor(along)), q=along-i;
      const u=p[i][0]*(1-q)+p[i+1][0]*q;
      const v=p[i][1]*(1-q)+p[i+1][1]*q;
      const w=.007+.054*t;
      return [...unproject(u+(s-.5)*w,v-(s-.5)*.018*t,impact[2]+.52-.06*t),s,.018+.062*t,0];
    });
    const fallCount=indices.length-poolCount;
    const sprayStart=vertices.length/6,sprayCount=390,dropCount=530;
    let seed=41012;
    function random(){seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;}
    for(let i=0;i<sprayCount+dropCount;i++)for(let j=0;j<6;j++)vertices.push(random());
    return {v:new Float32Array(vertices),i:new Uint16Array(indices),poolCount,fallCount,sprayStart,sprayCount,dropCount};
  }

  function create(canvas) {
    let gl;
    try { gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:true,
      preserveDrawingBuffer:false,depth:true,stencil:false,powerPreference:'low-power'}); }
    catch(e){return null;}
    if (!gl) return null;
    let lost=false, resources=null, lastPhoto=null;
    const mesh=makeGeometry();
    function build() {
      const objects={buffers:[],textures:[],shaders:[],program:null};
      resources=objects;
      function compile(type,source) {
        const sh=gl.createShader(type); objects.shaders.push(sh);
        gl.shaderSource(sh,source);gl.compileShader(sh);
        if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(sh));
        return sh;
      }
      const v=compile(gl.VERTEX_SHADER,vertex), f=compile(gl.FRAGMENT_SHADER,fragment);
      const prog=gl.createProgram(); objects.program=prog;
      gl.attachShader(prog,v);gl.attachShader(prog,f);gl.linkProgram(prog);
      if(!gl.getProgramParameter(prog,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      for(const name of ['uTime','uKind','uPhoto','uNoise','uBank','uPixelRatio'])
        objects[name]=gl.getUniformLocation(prog,name);
      const data=gl.createBuffer(), idx=gl.createBuffer(); objects.buffers.push(data,idx);
      gl.bindBuffer(gl.ARRAY_BUFFER,data);gl.bufferData(gl.ARRAY_BUFFER,mesh.v,gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,idx);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,mesh.i,gl.STATIC_DRAW);
      const a=gl.getAttribLocation(prog,'aPosition'), b=gl.getAttribLocation(prog,'aSurface');
      gl.enableVertexAttribArray(a);gl.enableVertexAttribArray(b);
      gl.vertexAttribPointer(a,3,gl.FLOAT,false,24,0);gl.vertexAttribPointer(b,3,gl.FLOAT,false,24,12);
      function texture(unit,wrap) {
        const tex=gl.createTexture();objects.textures.push(tex);
        gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,tex);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,wrap);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,wrap);
        return tex;
      }
      objects.photo=texture(0,gl.CLAMP_TO_EDGE);
      texture(1,gl.REPEAT);
      const noise=new Uint8Array(128*128*4);
      let seed=59473;
      for(let i=0;i<noise.length;i++){seed=(Math.imul(1664525,seed)+1013904223)>>>0;noise[i]=seed>>>24;}
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,128,128,0,gl.RGBA,gl.UNSIGNED_BYTE,noise);
      gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
      texture(2,gl.CLAMP_TO_EDGE);
      const mask=document.createElement('canvas');mask.width=768;mask.height=960;
      const g=mask.getContext('2d');
      g.fillStyle='#000';g.fillRect(0,0,768,960);g.fillStyle='#fff';g.filter='blur(1.45px)';
      g.beginPath();
      geometry.basin.forEach(([x,y],i)=>{if(i)g.lineTo(x*768,y*960);else g.moveTo(x*768,y*960);});
      g.closePath();g.fill();
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,mask);
      gl.uniform1i(objects.uPhoto,0);gl.uniform1i(objects.uNoise,1);gl.uniform1i(objects.uBank,2);
      gl.clearColor(0,0,0,0);gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
      lastPhoto=null;
    }
    function clean() {
      if(resources){
        for(const b of resources.buffers)gl.deleteBuffer(b);
        for(const tex of resources.textures)gl.deleteTexture(tex);
        for(const sh of resources.shaders)gl.deleteShader(sh);
        if(resources.program)gl.deleteProgram(resources.program);
        resources=null;
      }
      lastPhoto=null;
    }
    try{build();}catch(e){console.warn('Höhlenwasser',e.message);clean();return null;}
    function onLost(e){e.preventDefault();lost=true;resources=null;lastPhoto=null;}
    function onRestored(){try{build();lost=false;}catch(e){clean();lost=true;}}
    canvas.addEventListener('webglcontextlost',onLost);
    canvas.addEventListener('webglcontextrestored',onRestored);
    return {
      draw(photo,timeSec) {
        if(lost||!resources||!photo||!photo.complete||!photo.naturalWidth||gl.isContextLost())return false;
        const w=canvas.clientWidth,h=canvas.clientHeight;
        if(!w||!h)return false;
        const scale=Math.min(window.devicePixelRatio||1,1.5,880/w,1100/h);
        const width=Math.max(2,Math.round(w*scale)),height=Math.max(2,Math.round(h*scale));
        if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
        if(lastPhoto!==photo){
          gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,resources.photo);
          try{gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,photo);}catch(e){return false;}
          if(gl.getError()!==gl.NO_ERROR)return false;
          lastPhoto=photo;
        }
        gl.viewport(0,0,width,height);
        gl.depthMask(true);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
        gl.uniform1f(resources.uTime,timeSec%4096);gl.uniform1f(resources.uPixelRatio,width/660);
        gl.uniform1f(resources.uKind,0.);gl.drawElements(gl.TRIANGLES,mesh.poolCount,gl.UNSIGNED_SHORT,0);
        gl.depthMask(false);
        gl.uniform1f(resources.uKind,1.);gl.drawElements(gl.TRIANGLES,mesh.fallCount,gl.UNSIGNED_SHORT,mesh.poolCount*2);
        gl.uniform1f(resources.uKind,3.);gl.drawArrays(gl.POINTS,mesh.sprayStart+mesh.sprayCount,mesh.dropCount);
        gl.uniform1f(resources.uKind,2.);gl.drawArrays(gl.POINTS,mesh.sprayStart,mesh.sprayCount);
        return true;
      },
      dispose(){
        canvas.removeEventListener('webglcontextlost',onLost);
        canvas.removeEventListener('webglcontextrestored',onRestored);
        clean();
      }
    };
  }
  KF.Water={create};
})(globalThis.KF=globalThis.KF||{});

/* Animated water for the dry prasiolite plate. Coordinates are fractions of the photograph. */
(function (KF) {
  'use strict';
  const shore = [[0.413,0.704],[0.438,0.698],[0.509,0.698],[0.544,0.705],[0.552,0.72],[0.552,0.733],[0.578,0.744],[0.618,0.747],[0.69,0.75],[0.741,0.754],[0.804,0.758],[0.853,0.764],[0.905,0.771],[0.909,0.793],[0.91,0.823],[0.899,0.837],[0.859,0.851],[0.829,0.867],[0.817,0.881],[0.809,0.9],[0.81,0.922],[0.824,0.937],[0.845,0.941],[0.826,0.961],[0.808,0.978],[0.789,1],[0.5,1],[0.491,0.983],[0.481,0.971],[0.448,0.967],[0.407,0.969],[0.371,0.976],[0.327,0.985],[0.306,0.992],[0.286,0.996],[0.245,0.98],[0.225,0.97],[0.245,0.959],[0.251,0.945],[0.239,0.931],[0.212,0.919],[0.193,0.904],[0.163,0.887],[0.147,0.878],[0.164,0.872],[0.159,0.858],[0.142,0.845],[0.126,0.839],[0.136,0.833],[0.188,0.83],[0.211,0.819],[0.203,0.804],[0.255,0.797],[0.27,0.786],[0.282,0.777],[0.275,0.765],[0.266,0.759],[0.294,0.758],[0.301,0.753],[0.322,0.751],[0.337,0.75],[0.358,0.746],[0.379,0.74],[0.403,0.739],[0.398,0.731],[0.376,0.724],[0.371,0.719],[0.399,0.714]];
  const poolPath = new Path2D();
  shore.forEach(([x, y], i) => i ? poolPath.lineTo(x, y) : poolPath.moveTo(x, y));
  poolPath.closePath();

  const poolTop = .694;
  const lipX = .897, lipY = .315, footX = .806, footY = .764;
  const tau = Math.PI * 2;
  const limit = n => Math.max(0, Math.min(n, 1));
  function random(seed) {
    let n = seed >>> 0;
    return () => {
      n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
      return n / 4294967296;
    };
  }
  const rand = random(392327);
  const glints = Array.from({length: 220}, () => ({
    x: .06 + .94 * rand(), depth: rand(), length: .35 + rand(), phase: tau * rand(), speed: .5 + rand()
  }));
  const spray = Array.from({length: 95}, () => ({
    angle: rand() * tau, range: .008 + .069 * rand(), life: .24 + .42 * rand(),
    phase: rand(), height: .0018 + .021 * rand(), white: .25 + .75 * rand()
  }));
  const ripples = Array.from({length: 10}, (_, i) => ({
    offset: (i + .3 * rand()) / 10, angle: rand() * .9, phase: rand() * tau
  }));
  let basePool = null, basePhoto = null, fallNoise = null, sprayPuff = null;

  function canvas(w, h) {
    const surface = document.createElement('canvas');
    surface.width = w;
    surface.height = h;
    return surface;
  }

  function makePool(photo) {
    const w = 600, h = 230;
    const surface = canvas(w, h);
    const g = surface.getContext('2d');
    const naturalW = photo && (photo.naturalWidth || photo.width);
    const naturalH = photo && (photo.naturalHeight || photo.height);
    const bed = g.createLinearGradient(0, 0, 0, h);
    bed.addColorStop(0, '#102e2b');
    bed.addColorStop(.34, '#0a3935');
    bed.addColorStop(1, '#245343');
    g.fillStyle = bed;
    g.fillRect(0, 0, w, h);
    if (naturalW > 0 && naturalH > 0) {
      // Reflection is built once from the actual surrounding rocks and crystals.
      // Far water reflects the rock foot, near water picks up the high crystal walls.
      for (let row = 0; row < h; row += 2) {
        const depth = row / h;
        const mirrorY = .70 - .50 * Math.pow(depth, .88);
        const skew = Math.sin(row * .31) * Math.sin(row * .064) * (1 + 3 * depth);
        g.globalAlpha = .68 - depth * .13;
        g.drawImage(photo, 0, mirrorY * naturalH, naturalW, Math.max(2, naturalH * .0055),
                    skew - 6, row, w + 12, 2);
      }
      g.globalCompositeOperation = 'screen';
      g.globalAlpha = .26;
      g.drawImage(photo, 0, poolTop * naturalH, naturalW, (1 - poolTop) * naturalH, 0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
    }
    const tint = g.createLinearGradient(0, 0, 0, h);
    tint.addColorStop(0, 'rgba(4,31,29,.30)');
    tint.addColorStop(.57, 'rgba(5,54,45,.32)');
    tint.addColorStop(1, 'rgba(16,59,50,.28)');
    g.fillStyle = tint;
    g.fillRect(0, 0, w, h);
    g.save();
    g.globalCompositeOperation = 'destination-in';
    g.filter = 'blur(2.8px)';
    g.fillStyle = '#fff';
    g.beginPath();
    shore.forEach(([x, y], i) => {
      const px=x*w, py=(y-poolTop)*h/(1-poolTop);
      if (i) g.lineTo(px,py); else g.moveTo(px,py);
    });
    g.closePath(); g.fill();
    g.restore();
    return surface;
  }

  function makeFallTexture() {
    // Vertically coherent noise creates streams whose short irregular highlights travel downward.
    const width = 144, height = 256;
    const stream = canvas(width, height);
    const g = stream.getContext('2d');
    const pixels = g.createImageData(width, height);
    const grain = random(17382);
    const channel = new Float32Array(width);
    const phases = new Float32Array(width);
    const cycles = new Float32Array(width);
    for (let x = 0; x < width; x++) {
      channel[x] = Math.pow(grain(), 2.7);
      phases[x] = tau * grain();
      cycles[x] = 2 + Math.floor(7 * grain());
    }
    for (let y = 0; y < height; y++) {
      const angle = tau * y / height;
      for (let x = 0; x < width; x++) {
        const shift = .8 * Math.sin(angle * 2 + x * .19) + .6 * Math.sin(angle + x * .13);
        const source = Math.max(0, Math.min(width - 1.01, x + shift));
        const i = Math.floor(source), f = source - i;
        const specular = (channel[i] * (1-f) + channel[i+1] * f);
        const streak = .5 + .5 * Math.sin(angle * cycles[i] + phases[i]);
        const lane = x / (width - 1);
        const edge = Math.pow(Math.max(0, Math.sin(Math.PI * lane)), .55);
        const gaps = 1 - .87 * Math.exp(-((lane - .69) ** 2) / .0035);
        const strength = limit((.05 + specular * (.3 + .94 * streak) + .11 * grain()) * edge * gaps);
        const color = .27 + .68 * specular + .12 * streak;
        const k = (y * width + x) * 4;
        pixels.data[k] = Math.min(248, 124 + 118 * color);
        pixels.data[k+1] = Math.min(255, 161 + 89 * color);
        pixels.data[k+2] = Math.min(255, 164 + 86 * color);
        pixels.data[k+3] = Math.round(240 * strength);
      }
    }
    return pixels.data;
  }

  function pool(ctx, t, photo) {
    if (basePhoto !== photo || !basePool) {
      basePool = makePool(photo);
      basePhoto = photo;
    }
    ctx.save();
    ctx.clip(poolPath);
    // Refraction and reflection move across horizontal wavefronts, smaller near the far shore.
    const strips = 66;
    for (let j = 0; j < strips; j++) {
      const d = (j + .5) / strips, wave = Math.sin(31 * d - 1.45 * t);
      const x = (.001 + .0038 * d) * (wave + .55 * Math.sin(123 * d + 1.12 * t)) - .012;
      const source = limit(d + .003 * (1 + d) * Math.sin(67*d - t*1.6)) * (basePool.height - 6);
      ctx.globalAlpha = .91 - .08 * d;
      ctx.drawImage(basePool, 0, source, basePool.width, 5, x, poolTop + (1-poolTop)*j/strips,
                    1.024, (1 - poolTop) / strips + .0004);
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    // Reflections break into tiny horizontal slivers. The bottom of the pool is closer to the camera.
    for (let group = 0; group < 4; group++) {
      ctx.beginPath();
      for (let i = group; i < glints.length; i += 4) {
        const r = glints[i], d = r.depth;
        const a = Math.sin(r.phase + r.speed * t);
        if (a < .05) continue;
        const x = r.x + .005 * a * d, y = poolTop + (1-poolTop) * d + .0009 * Math.sin(r.phase + t);
        const width = (.0009 + .009 * d) * r.length * a;
        ctx.moveTo(x-width,y);
        ctx.quadraticCurveTo(x, y-.0008*d, x+width, y);
      }
      ctx.lineWidth = .00048 + .00013 * group;
      ctx.strokeStyle = ['rgba(182,226,206,.38)','rgba(133,200,174,.32)','rgba(229,231,192,.39)','rgba(138,188,167,.22)'][group];
      ctx.stroke();
    }
    // Circular wavefronts are viewed in perspective and broken by the uneven surface.
    for (const ring of ripples) {
      const d = (t * .37 + ring.offset) % 1;
      const x = footX + .002 * Math.sin(ring.phase), width = .023 + .190 * d;
      const y = footY + .009 + .004 * d;
      ctx.beginPath();
      ctx.ellipse(x,y,width,.0025 + d*.025,.012,ring.angle,2.65 + ring.angle);
      ctx.strokeStyle = 'rgba(189,223,207,' + (.39*(1-d)*(1-d)) + ')';
      ctx.lineWidth = .00081 + .0003 * (1-d);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(x,y,width*.98,.0024+d*.024,0,3.3+ring.angle,5.5 + ring.angle);
      ctx.strokeStyle = 'rgba(124,183,157,' + (.25*(1-d)) + ')';
      ctx.stroke();
    }
    ctx.restore();
  }

  const gravityCurve = q => (1 - Math.exp(-2.7*q)) / (1 - Math.exp(-2.7));
  function center(q) { return lipX + (footX-lipX) * gravityCurve(q); }
  const fallBox = { x:.750, y:.298, w:.194, h:.472 };
  let fallFrame = null, fallCtx = null, fallPixels = null;
  function fall(ctx,t) {
    if (!fallNoise) {
      fallNoise = makeFallTexture();
      fallFrame = canvas(160,465);
      fallCtx = fallFrame.getContext('2d');
      fallPixels = fallCtx.createImageData(fallFrame.width, fallFrame.height);
    }
    const fw = fallFrame.width, fh = fallFrame.height, pixels = fallPixels.data;
    const phase = t*175;
    for (let row=0;row<fh;row++) {
      const y=fallBox.y+(row+.5)/fh*fallBox.h;
      const d=limit((y-lipY)/(footY-lipY));
      const axis=center(d)+d*.0028*Math.sin(13*d - t*3.7);
      const width=.053+.012*Math.sin(d*2.7)+.015*d + .0018*d*Math.sin(24*d - t*4.7);
      const sourceY=(Math.floor(Math.sqrt(d+.04)*590-phase)%256+256)%256;
      const sway=(.6+1.0*d)*Math.sin(31*d - 3.8*t) + .7*d*Math.sin(77*d-6*t);
      const tilt=-.28*Math.exp(-10*d);
      for(let col=0;col<fw;col++) {
        const k=4*(row*fw+col),x=fallBox.x+(col+.5)/fw*fallBox.w;
        const u=(x-axis)/width+.5, nearLip=lipY + tilt*(x-axis);
        if(u<=0 || u>=1 || y<nearLip || y>footY+.0008) {pixels[k+3]=0;continue;}
        const warped=Math.max(0, Math.min(142.999,u*143 + sway));
        const ix=Math.floor(warped), f=warped-ix;
        const i=4*(sourceY*144+ix);
        const soft=limit((y-nearLip)/.006)*limit((footY+.001-y)/.004);
        const a=fallNoise[i+3]+(fallNoise[i+7]-fallNoise[i+3])*f;
        const light=fallNoise[i]+(fallNoise[i+4]-fallNoise[i])*f;
        pixels[k]=light;
        pixels[k+1]=Math.min(255,light*.88+44);
        pixels[k+2]=Math.min(255,light*.86+49);
        pixels[k+3]=Math.min(255, (a*1.27 + 4*Math.sin(u*Math.PI)) * soft);
      }
    }
    fallCtx.putImageData(fallPixels,0,0);
    ctx.save();
    ctx.drawImage(fallFrame,fallBox.x,fallBox.y,fallBox.w,fallBox.h);
    // Fine secondary rivulets catch the light either side of the central sheet.
    ctx.lineCap = 'round';
    for (let i = 0; i < 36; i++) {
      const k = i * 251.33, s = ((t * (.41 + (i%5)*.012) + i * .239) % 1);
      const depth = s*s, end = Math.min(1, depth + .015 + .08 * ((i%7)/7));
      const lane = .026*Math.sin(k) + (i%5===0 ? .018 : 0);
      ctx.beginPath();
      for(let j=0; j<4; j++) {
        const d = depth + (end-depth)*j/3;
        const x = center(d) + lane * (1 + .38*d) + .0026 * Math.sin(k + d * 26 - t*3) * d;
        const y = lipY+(footY-lipY)*d - .28 * lane * Math.exp(-10*d);
        if(j===0)ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.lineWidth = .00055 + (i%4)*.00025;
      ctx.strokeStyle = 'rgba(217,237,231,' + (.19 + .17*Math.sin(s*Math.PI)) + ')';
      ctx.stroke();
    }
    ctx.restore();
  }

  function puff() {
    const cv = canvas(112,112), g = cv.getContext('2d');
    const fog = g.createRadialGradient(56,56,0,56,56,56);
    fog.addColorStop(0,'rgba(217,237,232,.32)');
    fog.addColorStop(.35,'rgba(199,225,220,.17)');
    fog.addColorStop(1,'rgba(195,218,216,0)');
    g.fillStyle=fog; g.fillRect(0,0,112,112);
    return cv;
  }

  function impact(ctx,t) {
    if (!sprayPuff) sprayPuff=puff();
    ctx.drawImage(sprayPuff, footX-.070, footY-.025, .140, .045);
    ctx.drawImage(sprayPuff, footX-.041, footY-.006, .082, .015);
    ctx.drawImage(sprayPuff, footX-.028, footY-.015, .056, .022);
    ctx.save();
    ctx.lineCap='round';
    for (let i=0; i<spray.length; i++) {
      const r = spray[i], s=(r.phase+t/r.life)%1, rad = r.range*s;
      const x = footX + Math.cos(r.angle)*rad;
      const y = footY + .002 + Math.sin(r.angle)*rad*.16 - r.height * 4*s*(1-s);
      ctx.beginPath();
      ctx.moveTo(x,y);
      ctx.lineTo(x+Math.cos(r.angle)*.0008,y - .0009*(1-2*s));
      ctx.lineWidth = (.0006 + .0016*(1-s))*r.white;
      ctx.strokeStyle = 'rgba(221,242,234,' + ((.25 + .61*r.white)*(1-.6*s)) + ')';
      ctx.stroke();
    }
    ctx.restore();
  }

  KF.WaterFallback = {
    draw(ctx, timeSeconds, photo) {
      ctx.save();
      pool(ctx, timeSeconds, photo);
      fall(ctx, timeSeconds);
      impact(ctx, timeSeconds);
      ctx.restore();
    }
  };
})(window.KF = window.KF || {});

(function(KF) {
  'use strict';
  const roomCaches = new WeakMap();
  const WIDTH = 600, HEIGHT = 750, STEPS = 12;

  // Geometry in the reference portraits. These polygons isolate exposed faces
  // of individual specimens, so light cannot travel onto the surrounding stone.
  const crystalFaces = {
    citrine: [
      [[8,6],[23,18],[31,62],[17,66],[8,44]],
      [[81,67],[92,51],[99,68],[106,113],[86,99]],
      [[123,81],[139,57],[151,77],[154,145],[133,140]],
      [[154,135],[174,111],[181,132],[183,169],[166,157]],
      [[0,178],[15,155],[26,169],[30,216],[4,219]],
      [[75,197],[81,201],[93,241],[85,253],[71,231]],
      [[118,238],[137,220],[148,233],[151,271],[135,274]],
      [[53,412],[64,396],[76,407],[85,469],[59,463]],
      [[97,421],[119,385],[130,396],[132,467],[105,471]],
      [[132,445],[143,428],[153,443],[161,476],[140,476]],
      [[190,475],[218,454],[232,467],[223,518],[202,521]],
      [[64,618],[91,594],[100,601],[93,654],[67,674]],
      [[386,311],[398,283],[411,294],[421,344],[400,356]],
      [[443,230],[464,208],[480,223],[479,291],[452,321]],
      [[509,184],[533,143],[541,160],[539,246],[516,264]],
      [[562,148],[580,127],[594,139],[590,207],[571,221]],
      [[567,109],[586,90],[598,103],[599,150],[581,153]]
    ],
    smoky: [
      [[133,38],[176,6],[196,55],[182,111],[173,151],[127,119]],
      [[52,155],[70,117],[104,135],[122,170],[100,254],[73,239]],
      [[38,371],[60,270],[81,256],[109,289],[99,359],[74,388]],
      [[62,423],[125,350],[150,329],[139,379],[91,449]],
      [[406,101],[418,55],[463,77],[478,113],[464,153],[428,157]],
      [[439,184],[454,159],[485,149],[521,245],[505,300],[477,282]],
      [[529,172],[548,147],[566,169],[592,243],[578,260],[548,224]],
      [[428,345],[447,321],[463,329],[480,393],[454,409]]
    ]
  };

  function canvas(w,h) {
    const cv=document.createElement('canvas');
    cv.width=Math.max(1,Math.ceil(w)); cv.height=Math.max(1,Math.ceil(h));
    return cv;
  }
  function polygon(g,points) {
    g.beginPath(); g.moveTo(points[0][0],points[0][1]);
    for (let i=1;i<points.length;i++) g.lineTo(points[i][0],points[i][1]);
    g.closePath();
  }

  // A compact strip of light masks per facet is sampled and blended in time.
  // Transmission follows the local photograph's luminance and mineral colour.
  function prepareFaces(photo,key) {
    return crystalFaces[key].map((points,index)=>{
      const left=Math.floor(Math.min(...points.map(p=>p[0])))-1;
      const top=Math.floor(Math.min(...points.map(p=>p[1])))-1;
      const w=Math.ceil(Math.max(...points.map(p=>p[0])))-left+1;
      const h=Math.ceil(Math.max(...points.map(p=>p[1])))-top+1;
      const texture=canvas(w,h), g=texture.getContext('2d',{willReadFrequently:true});
      g.translate(-left,-top); polygon(g,points); g.clip(); g.drawImage(photo,0,0,WIDTH,HEIGHT);
      const pixels=g.getImageData(0,0,w,h).data;
      const atlas=canvas(w*STEPS,h), a=atlas.getContext('2d');
      const strip=a.createImageData(w,h);
      const amber=key==='citrine', slope=index%3===0 ? -0.32 : 0.24;
      for (let frame=0;frame<STEPS;frame++) {
        const center=frame/(STEPS-1)*1.45-0.22;
        for(let py=0;py<h;py++) for(let px=0;px<w;px++) {
          const i=(py*w+px)*4, luma=(pixels[i]*.30+pixels[i+1]*.59+pixels[i+2]*.11)/255;
          const transmission=amber ? Math.min(1, Math.max(0,(pixels[i]-pixels[i+2]-3)/52)) : 1;
          const distance=(px/w+slope*(py/h-.5)-center);
          const band=Math.exp(-distance*distance/0.028);
          const high=Math.min(1,Math.max(0,(luma-.08)/.66));
          strip.data[i]=amber?255:232; strip.data[i+1]=amber?213:230; strip.data[i+2]=amber?131:224;
          strip.data[i+3]=pixels[i+3]*band*(.18+high*.82)*transmission*(amber?.73:.48);
        }
        a.putImageData(strip,frame*w,0);
      }
      return {atlas,left,top,w,h,phase:(index*.61803)%1,speed:4.0+(index%5)*.67};
    });
  }

  function movingFaces(ctx,faces,t) {
    ctx.save(); ctx.globalCompositeOperation='screen';
    const alpha=ctx.globalAlpha;
    for(const f of faces) {
      const cycle=(t/f.speed+f.phase)%1;
      const u=cycle*1.30-.12;
      if(u<=0 || u>=1) continue;
      const progress=u*(STEPS-1), frame=Math.floor(progress), mix=progress-frame;
      const envelope=Math.min(1, u*6, (1-u)*6);
      ctx.globalAlpha=alpha*(1-mix)*envelope;
      ctx.drawImage(f.atlas,frame*f.w,0,f.w,f.h,f.left,f.top,f.w,f.h);
      ctx.globalAlpha=alpha*mix*envelope;
      ctx.drawImage(f.atlas,(frame+1)*f.w,0,f.w,f.h,f.left,f.top,f.w,f.h);
    }
    ctx.restore();
  }

  const waterLeft=66, waterTop=471, waterW=404, waterH=279;
  const wetSurface=[[244,477],[319,474],[317,482],[350,488],[355,513],[378,535],
    [453,542],[459,572],[419,578],[418,599],[398,608],[396,643],
    [358,657],[344,681],[331,748],[70,748],[109,712],[169,665],[172,626],
    [194,596],[230,583],[237,550],[273,545],[279,532],[261,525],[243,512]];
  function makeReflections(photo) {
    const tex=canvas(waterW,waterH), g=tex.getContext('2d');
    g.translate(-waterLeft,-waterTop); g.drawImage(photo,0,0,WIDTH,HEIGHT);
    // Softly trim the sampling texture to the open water; nearby rocks and
    // crystal ledges stay fixed even as the reflected highlights undulate.
    const mask=canvas(waterW,waterH), m=mask.getContext('2d');
    m.translate(-waterLeft,-waterTop); m.filter='blur(2px)';
    polygon(m,wetSurface); m.fillStyle='white'; m.fill();
    g.globalCompositeOperation='destination-in'; g.setTransform(1,0,0,1,0,0);
    g.drawImage(mask,0,0);
    return tex;
  }

  function animateReflection(ctx,water,t) {
    ctx.save(); ctx.globalAlpha*=.84;
    for(let y=0;y<waterH;y+=3) {
      const depth=y/waterH;
      const displacement=(.35+2.6*depth)*(Math.sin(y*.115-t*2.05)
                    +.44*Math.sin(y*.30+t*2.51));
      const stripHeight=Math.min(3,waterH-y);
      ctx.drawImage(water,0,y,waterW,stripHeight,waterLeft+displacement,waterTop+y,waterW,stripHeight);
    }
    ctx.restore();
  }

  function latticeNoise(x,y) {
    const hash=(a,b)=>{
      let k=Math.imul(a+2311,0x45d9f3b)^Math.imul(b+8221,0x119de1f3);
      k=Math.imul(k^k>>>16,0x45d9f3b);
      return ((k^k>>>15)>>>0)/4294967296;
    };
    const ix=Math.floor(x), iy=Math.floor(y);
    const f=x-ix, q=y-iy, sx=f*f*(3-2*f), sy=q*q*(3-2*q);
    const a=hash(ix,iy), b=hash(ix+1,iy), c=hash(ix,iy+1), d=hash(ix+1,iy+1);
    return (a+(b-a)*sx)*(1-sy)+(c+(d-c)*sx)*sy;
  }

  function lowMist(seed) {
    const w=160,h=46, tex=canvas(w,h),g=tex.getContext('2d'), img=g.createImageData(w,h);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      const u=x/(w-1),v=y/(h-1);
      const billow=latticeNoise(u*6+seed,v*3+seed)*.65+latticeNoise(u*15,v*5+seed)*.35;
      const height=.50+ .105*Math.sin(u*8+seed)+.05*Math.sin(u*18);
      const haze=Math.exp(-Math.pow((v-height)/.27,2)) * Math.pow(Math.sin(u*Math.PI),1.4);
      const a=Math.max(0,(billow-.19))*haze;
      const i=4*(y*w+x);
      img.data[i]=175;img.data[i+1]=185;img.data[i+2]=183;img.data[i+3]=Math.min(68,a*111);
    }
    g.putImageData(img,0,0);
    return tex;
  }

  function lightShafts() {
    // The photographed ceiling openings feed the shafts, which are feathered
    // along their width and taper out before reaching the stairway.
    const tex=canvas(160,200),g=tex.getContext('2d'),img=g.createImageData(160,200);
    for(let y=0;y<200;y++) for(let x=0;x<160;x++) {
      const u=x/159, v=y/199;
      const drift=u+.51*v;
      const beams=.74*Math.exp(-Math.pow((drift-.763)/(.017+.036*v),2))
                 +.49*Math.exp(-Math.pow((drift-.722)/(.013+.021*v),2))
                 +.56*Math.exp(-Math.pow((drift-.622)/(.018+.026*v),2));
      const fade=Math.max(0,1-v/.70);
      const a=beams*fade*(.78+.22*latticeNoise(u*12,v*8));
      const i=4*(y*160+x);
      img.data[i]=208;img.data[i+1]=220;img.data[i+2]=225;img.data[i+3]=a*131;
    }
    g.putImageData(img,0,0);return tex;
  }

  function smokyAir(ctx,cache,t) {
    ctx.save();
    const alpha=ctx.globalAlpha;
    ctx.globalCompositeOperation='screen';
    ctx.globalAlpha=alpha*(.46+.35*Math.sin(t*.85)+.10*Math.sin(t*1.47));
    ctx.drawImage(cache.shaft,Math.sin(t*.69)*2.1,0,WIDTH,HEIGHT);
    ctx.globalAlpha=alpha*.63;
    ctx.drawImage(cache.mists[0],169+15*Math.sin(t*.34),485+3*Math.sin(t*.6),238,66);
    ctx.globalAlpha=alpha*.61;
    ctx.drawImage(cache.mists[1],187+19*Math.sin(t*.27+2),521+3*Math.sin(t*.39+1),244,49);
    ctx.globalAlpha=alpha;
    for(let p=0;p<17;p++) {
      const life=(p*.618+t*(.035+p%3*.006))%1;
      const y=46+life*306+p%3*9;
      const x=458-.40*y+(p%5-2)*9+Math.sin(life*9+p)*7;
      const opacity=Math.sin(life*Math.PI)*(.21+.14*Math.sin(t*1.72+p));
      ctx.fillStyle='rgba(220,223,211,'+opacity.toFixed(3)+')';
      ctx.beginPath();ctx.ellipse(x,y,.48+p%3*.17,.55+p%2*.32,-.4,0,2*Math.PI);ctx.fill();
    }
    ctx.restore();
  }

  function render(ctx,key,t,photo) {
    if(!photo || !(photo.naturalWidth || photo.width)) return;
    if(key==='amethyst'||key==='rose') { drawGemFaces(ctx,key,t,photo); return; }
    if(key!=='citrine' && key!=='smoky') return;
    let byRoom=roomCaches.get(photo);
    if(!byRoom){byRoom=new Map();roomCaches.set(photo,byRoom);}
    let cache=byRoom.get(key);
    if(!cache){
      cache={faces:prepareFaces(photo,key)};
      if(key==='citrine') cache.water=makeReflections(photo);
      if(key==='smoky') {cache.shaft=lightShafts();cache.mists=[lowMist(12),lowMist(36)];}
      byRoom.set(key,cache);
    }
    ctx.save(); ctx.scale(1/WIDTH,1/HEIGHT);
    if(key==='citrine') animateReflection(ctx,cache.water,t);
    else smokyAir(ctx,cache,t);
    movingFaces(ctx,cache.faces,t);
    ctx.restore();
  }

  // Measured against the photographed mineral faces, in a 616 × 770 reference frame.
  const refractionFaces = {
    rose: [
      [[47,295, 82,212, 117,180, 149,215, 122,306, 71,310], .1],
      [[117,180, 149,198, 183,236, 151,220], .9],
      [[124,307, 151,222, 181,242, 176,334], 2.4],
      [[480,106, 496,56, 528,23, 516,68], 2.1],
      [[480,106, 516,69, 548,44, 536,150, 506,191, 481,220], 2.7],
      [[481,220, 506,191, 535,150, 559,118, 564,172, 525,219], 3.5],
      [[376,473, 389,415, 433,365, 463,344, 419,415], .7],
      [[375,472, 420,416, 462,345, 478,370, 405,477, 379,509], 1.6],
      [[58,329, 87,371, 141,438, 105,417, 72,374], 3.3],
      [[85,414, 119,434, 166,464, 203,504, 166,485, 109,448], 3.9],
      [[200,362, 211,332, 235,349, 220,363], 2.2],
      [[71,610, 88,576, 139,571, 164,608, 123,581, 90,581], .8]
    ],
    amethyst: [
      [[16,294, 87,285, 43,318, 26,325], 2.3],
      [[27,326, 87,285, 55,334, 30,350], 2.8],
      [[105,393, 146,355, 142,407], .8],
      [[55,474, 102,438, 146,421, 111,503], .4],
      [[112,502, 146,423, 162,418, 136,506, 123,529], 1.2],
      [[5,578, 34,543, 81,535, 65,582], 4.1],
      [[56,613, 89,563, 126,548, 99,594, 66,630], 3.6],
      [[108,681, 131,635, 139,617, 151,651], 2.7],
      [[535,495, 544,451, 555,423, 576,441], 2.4],
      [[554,421, 593,449, 598,464, 574,444], 3.2],
      [[462,419, 478,392, 500,381, 495,411], .1],
      [[466,493, 471,472, 492,450, 493,479], .75],
      [[403,113, 423,96, 434,111, 421,130, 408,137], 4.7],
      [[530,329, 546,304, 554,317, 543,345], 3.6],
      [[215,726, 233,702, 261,692, 247,712], 1.0]
    ]
  };
  const refractionCache = new WeakMap();

  function prepareGemFaces(photo, key) {
    // Extract the lit seams from the photograph. The lights will pick up its existing
    // fractures and preserve the dark transparent pits within each illuminated plane.
    const relief = document.createElement('canvas');
    relief.width = 616; relief.height = 770;
    const g = relief.getContext('2d', {willReadFrequently:true});
    g.drawImage(photo, 0, 0, 616, 770);
    const source = g.getImageData(0, 0, 616, 770);
    const data = source.data;
    const pink = key === 'rose';
    for (let i=0; i<data.length; i+=4) {
      const brightness = data[i] * .3 + data[i+1] * .52 + data[i+2] * .18;
      const chroma = data[i+2] - data[i+1];
      const strength = Math.max(0, Math.min(1, (brightness - (pink ? 74 : 21)) / (pink ? 133 : 156)));
      data[i] = pink ? 255 : 218 + strength * 37;
      data[i+1] = pink ? 183 + strength * 67 : 141 + strength * 87;
      data[i+2] = pink ? 169 + strength * 81 : 248;
      data[i+3] = Math.min(255, 255 * (.12 + .88 * strength * strength) * (pink ? 1 : Math.min(1,.74 + chroma / 130)));
    }
    g.putImageData(source, 0, 0);
    const faces = refractionFaces[key].map(([points, phase], i) => {
      const path = new Path2D();
      const xs=[], ys=[];
      for(let j=0;j<points.length;j+=2) {
        const x=points[j], y=points[j+1];
        xs.push(x); ys.push(y);
        if(j===0) path.moveTo(x,y); else path.lineTo(x,y);
      }
      path.closePath();
      const x=Math.min(...xs), y=Math.min(...ys), w=Math.max(...xs)-x, h=Math.max(...ys)-y;
      return {path,x,y,w,h,phase,rate:.86 + (i%4)*.047};
    });
    return {relief, faces};
  }

  function drawGemFaces(ctx, key, t, photo) {
    if (!photo || !refractionFaces[key] || !photo.naturalWidth) return;
    let cache=refractionCache.get(photo);
    if (!cache) { cache=prepareGemFaces(photo,key); refractionCache.set(photo,cache); }
    const pink = key === 'rose';
    const rayTint = pink ? '255,233,211' : '235,207,255';
    ctx.save();
    ctx.scale(1/616,1/770);
    const inherited=ctx.globalAlpha;
    for (const {path,x,y,w,h,phase,rate} of cache.faces) {
      const theta=t*rate+phase;
      // A broad return from the cleavage plane, with a narrower moving internal reflection.
      const returnLight=Math.pow(.5+.5*Math.sin(theta),2.7);
      if(returnLight < .006) continue;
      ctx.save(); ctx.clip(path);
      ctx.globalAlpha=inherited * returnLight * (pink ? .69 : .75);
      ctx.drawImage(cache.relief,x,y,w,h,x,y,w,h);
      const center=x+w*(.5+.48*Math.sin(theta-.64));
      const sweep=ctx.createLinearGradient(center-w*.43,y+h*.4,center+w*.43,y+h*.57);
      sweep.addColorStop(0,'rgba('+rayTint+',0)');
      sweep.addColorStop(.33,'rgba('+rayTint+',.045)');
      sweep.addColorStop(.50,'rgba('+rayTint+',.24)');
      sweep.addColorStop(.56,'rgba('+rayTint+',.12)');
      sweep.addColorStop(1,'rgba('+rayTint+',0)');
      ctx.fillStyle=sweep; ctx.fillRect(x,y,w,h);
      ctx.restore();
    }
    ctx.restore();
  }

  KF.MineralMotion = { draw: render };
})(globalThis.KF = globalThis.KF || {});

// Photo-space effects. Coordinates refer to visible features in the original 4:5 plates.
(function (KF) {
  'use strict';
  const tau = 2 * Math.PI;
  const cache = new WeakMap();
  const cloudSprites = new Map();
  const clamp = x => Math.max(0, Math.min(1, x));
  function hash(n) {
    const x = Math.sin(n * 127.1 + 63.17) * 43758.5453;
    return x - Math.floor(x);
  }
  function noise(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const dx = x - ix, dy = y - iy;
    const sx = dx * dx * (3 - 2 * dx), sy = dy * dy * (3 - 2 * dy);
    const base = seed + ix + iy * 79;
    const a = hash(base), b = hash(base + 1), c = hash(base + 79), d = hash(base + 80);
    return (a + sx * (b - a)) * (1 - sy) + (c + sx * (d - c)) * sy;
  }
  function canvas(width, height) {
    const cv = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
    cv.width = width; cv.height = height;
    return cv;
  }
  function path(ctx, coordinates) {
    ctx.beginPath();
    ctx.moveTo(coordinates[0], coordinates[1]);
    for (let i = 2; i < coordinates.length; i += 2) ctx.lineTo(coordinates[i], coordinates[i + 1]);
    ctx.closePath();
  }

  // Debris, submerged rocks and banks protrude into the water in both photographs.
  const darkWater = [
    .175,.702, .193,.685, .299,.681, .354,.669, .47,.669, .56,.681, .66,.689, .76,.694, .85,.708, 1,.722,
    1,.852, .979,.860, .966,.882, .948,.868, .927,.898, .890,.903, .866,.918, .850,.888, .837,.879, .814,.915,
    .800,.910, .786,.943, .751,.944, .730,.968, .659,.963, .591,.984, .525,.991, .297,.991,
    .279,.974, .276,.947, .251,.935, .211,.931, .196,.922, .174,.927, .161,.912, .146,.922, .128,.897,
    .100,.894, .081,.890, .075,.868, .029,.858, .023,.841, 0,.835, 0,.794, .075,.781, .101,.758, .144,.724
  ];
  const blueWater = [
    .241,.661, .259,.659, .270,.652, .296,.649, .315,.655, .347,.653, .322,.644, .331,.64,
    .425,.639, .526,.638, .608,.638, .639,.645, .694,.646, .760,.646, .782,.663, .807,.659, .834,.665, .890,.665, .916,.668, 1,.67,
    1,1, .660,1, .587,.964, .597,.944, .568,.937, .549,.917, .546,.899, .530,.866, .503,.859, .461,.852,
    .478,.829, .451,.812, .404,.805, .368,.803, .371,.779, .344,.765, .308,.760, .308,.743, .293,.725, .281,.715, .266,.690
  ];
  const water = {
    ice: { shore: darkWater, horizon: .669, light: [[.119,.81,.030,.060],[.275,.733,.085,.058],[.892,.777,.066,.092]], speed: .79 },
    lake: { shore: blueWater, horizon: .638, light: [[.849,.765,.096,.11],[.701,.700,.090,.054],[.401,.803,.094,.041]], speed: .99 }
  };

  // Wave fronts displace the underlying photograph. Both the reflections and the transparent
  // shallows deform, while the exact rocky banks stay fixed. The waves widen towards the viewer.
  function moveWater(ctx, t, photo, pool) {
    const sw = photo.naturalWidth, sh = photo.naturalHeight;
    ctx.save();
    path(ctx, pool.shore);
    ctx.clip();
    const back = pool.horizon, range = 1 - back;
    const steps = 60;
    for (let i = 0; i < steps; i++) {
      const z = i / steps, z2 = (i + 1) / steps;
      const y = back + range * (z * .44 + .56 * z * z);
      const end = back + range * (z2 * .44 + .56 * z2 * z2);
      const depth = .21 + .79 * z, phase = t * pool.speed;
      const h = end - y + .00016;
      const wave = Math.sin(y * 304 - phase * 1.65) + .43 * Math.sin(y * 166 + phase * 1.24);
      const sx = depth * (.0031 * wave), sy = depth * (.0019 * Math.sin(y * 278 - phase * 1.72));
      ctx.globalAlpha = .57 * Math.min(1, (i + 1) / 6);
      // Crop inside the image at left/right: displace adjacent visual detail without an exposed seam.
      ctx.drawImage(photo, (.007 + sx) * sw, Math.min(.997, y + sy) * sh, .986 * sw, Math.min(h, 1 - y) * sh,
                    .007, y, .986, h);
    }
    // Short, softly ended crests pass through the actual columns reflected from the bright openings.
    for (let column = 0; column < pool.light.length; column++) {
      const [cx, cy, width, height] = pool.light[column];
      for (let i = 0; i < 9; i++) {
        const seed = 30 * column + i;
        const phase = (t * (.095 + hash(seed + 3) * .05) + hash(seed)) % 1;
        const shade = Math.pow(Math.sin(phase * Math.PI), 1.7);
        const x = cx + (hash(seed + 7.32) - .5) * width + .005 * Math.sin(t * .52 + seed);
        const y = cy + (hash(seed + 13.2) - .5) * 2 * height + phase * .009;
        const len = (.005 + .015 * hash(seed + 5.8)) * (1 + .22 * Math.sin(t * .76 + seed));
        const g = ctx.createLinearGradient(x - len, y, x + len, y);
        g.addColorStop(0, 'rgba(181,231,237,0)');
        g.addColorStop(.46, 'rgba(191,238,242,.40)');
        g.addColorStop(1, 'rgba(181,231,237,0)');
        ctx.globalAlpha = shade * .72;
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(x, y, len, .00048 + .00043 * hash(seed + 1.8), .012 * Math.sin(seed), 0, tau); ctx.fill();
      }
    }
    ctx.restore();
  }

  // Actual stalactite tips, vertical drip lines and the perspective plane they strike.
  const dripSites = [
    [.445,.357,.769,8.8,3.1,.102], [.522,.292,.728,10.3,6.8,.084],
    [.717,.303,.807,11.8,1.4,.124], [.197,.378,.715,13.8,7.4,.063]
  ];
  function strikeWater(ctx, t) {
    for (let index = 0; index < dripSites.length; index++) {
      const [x, tip, impact, period, offset, scale] = dripSites[index];
      const count = Math.floor((t + offset) / period);
      const age = (t + offset) % period - (1.05 + hash(count + index * 28) * 1.45);
      if (age < -.56 || age > 3.4) continue;
      if (age < 0) {
        const u = (age + .56) / .56;
        const y = tip + (impact - tip) * u * u;
        ctx.strokeStyle = 'rgba(182,219,219,' + (.13 + u * .24) + ')';
        ctx.lineWidth = .00118; ctx.beginPath();
        ctx.moveTo(x, y - (.0013 + u * .0055)); ctx.lineTo(x, y); ctx.stroke();
        ctx.fillStyle = 'rgba(219,238,234,.49)';
        ctx.beginPath(); ctx.ellipse(x, y, .0009, .0015, 0, 0, tau); ctx.fill();
        continue;
      }
      ctx.save(); path(ctx, darkWater); ctx.clip();
      for (let k = 0; k < 3; k++) {
        const life = age - k * .139;
        if (life < 0 || life >= 2.94) continue;
        const progress = life / 2.94;
        const rx = (.032 + .968 * (1 - Math.pow(1 - progress, 1.5))) * scale;
        const ry = rx * (.115 + .055 * (impact - .714) / .11);
        const alpha = Math.pow(1 - progress, 1.4) * (1 - .19 * k) * Math.min(1, life * 20);
        const ring = ctx.createLinearGradient(x - rx, impact, x + rx, impact);
        ring.addColorStop(0, 'rgba(157,205,206,.30)'); ring.addColorStop(.23, 'rgba(182,219,218,.83)');
        ring.addColorStop(.42, 'rgba(123,158,162,.12)'); ring.addColorStop(.64, 'rgba(160,213,212,.45)');
        ring.addColorStop(1, 'rgba(114,149,151,.10)');
        ctx.globalAlpha = alpha * .89; ctx.lineWidth = .00115 - progress * .00055; ctx.strokeStyle = ring;
        ctx.beginPath(); ctx.ellipse(x, impact, rx, ry, 0, 0, tau); ctx.stroke();
        ctx.globalAlpha = alpha * .48;
        ctx.strokeStyle = '#031112';
        ctx.beginPath(); ctx.ellipse(x, impact + .0011, rx, ry, 0, .12, Math.PI * .97); ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Texture of low water mist or airborne rock dust. The irregular transparent edges are baked once.
  function cloudSprite(warm, seed) {
    const key = (warm ? 20 : 0) + seed;
    if (cloudSprites.has(key)) return cloudSprites.get(key);
    const cv = canvas(190, 60), g = cv.getContext('2d'), data = g.createImageData(cv.width, cv.height);
    const colour = warm ? [213,143,98] : [190,219,223];
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
      const u = x / cv.width, v = y / cv.height;
      const bend = .15 * Math.sin(tau * (u + seed * .34)) + .08 * Math.cos(10 * u);
      const dy = (v - .50 - bend) / .48;
      const edge = Math.max(0, 1 - dy * dy) * Math.sin(Math.PI * u);
      const n = .56 * noise(u * 7, v * 4, seed * 83) + .30 * noise(u * 17, v * 9, seed * 43 + 7)
              + .14 * noise(u * 37, v * 17, seed * 61);
      const alpha = Math.pow(Math.max(0, n - .26) * 1.57, 1.45) * edge * edge;
      const offset = 4 * (y * cv.width + x);
      data.data.set([colour[0], colour[1], colour[2], Math.round(255 * alpha)], offset);
    }
    g.putImageData(data, 0, 0); cloudSprites.set(key, cv); return cv;
  }

  // Polygonal regions are traced along individual illuminated facets and bands in the photographs.
  const iceRims = [
    [.162,.546,.187,.488,.209,.465,.237,.447,.267,.434,.250,.467,.208,.495,.184,.531],
    [.266,.404,.288,.356,.327,.323,.403,.303,.484,.272,.504,.235,.513,.245,.509,.298,.489,.323,.437,.338,.371,.335,.302,.371],
    [.113,.267,.104,.217,.129,.177,.165,.157,.189,.160,.150,.185,.131,.222,.165,.287,.183,.307,.184,.349,.155,.326],
    [.623,.184,.691,.164,.757,.167,.809,.149,.878,.128,.888,.136,.831,.165,.762,.183,.693,.190],
    [.613,.638,.664,.603,.704,.582,.758,.548,.781,.535,.761,.566,.722,.595,.692,.620,.669,.647]
  ];
  const redFaces = [
    [.031,.187,.079,.110,.130,.083,.174,.083,.212,.055,.197,.102,.141,.127,.101,.181,.078,.244,.055,.260,.050,.226],
    [.002,.256,.049,.265,.083,.286,.102,.322,.150,.352,.168,.384,.125,.377,.081,.353,.053,.296],
    [.143,.419,.160,.414,.208,.425,.244,.456,.214,.490,.169,.512,.177,.474],
    [.765,.606,.786,.564,.818,.523,.873,.499,.914,.512,.935,.537,.917,.544,.873,.521,.825,.538,.807,.576,.797,.609],
    [.894,.262,.924,.246,.993,.226,.999,.258,.964,.279,.936,.282,.906,.316,.883,.316],
    [.654,.870,.675,.827,.681,.772,.702,.745,.709,.732,.746,.724,.731,.758,.710,.792,.691,.857]
  ];
  function highlights(photo, warm) {
    if (cache.has(photo)) return cache.get(photo);
    const faces = warm ? redFaces : iceRims;
    const textures = [];
    for (const face of faces) {
      const xs = [], ys = [];
      for (let i = 0; i < face.length; i += 2) { xs.push(face[i]); ys.push(face[i + 1]); }
      const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
      const cv = canvas(Math.max(3, Math.ceil(w * 810)), Math.max(3, Math.ceil(h * 1013)));
      const g = cv.getContext('2d', {willReadFrequently:true}), sw = photo.naturalWidth, sh = photo.naturalHeight;
      const coords = face.map((v, i) => i % 2 ? (v-y) * cv.height/h : (v-x) * cv.width/w);
      g.save(); path(g, coords); g.clip();
      g.drawImage(photo, x*sw,y*sh,w*sw,h*sh,0,0,cv.width,cv.height); g.restore();
      const bitmap = g.getImageData(0,0,cv.width,cv.height), p = bitmap.data;
      const values = new Float32Array(p.length / 4);
      for (let i = 0; i < values.length; i++) values[i] = .24*p[i*4]+.65*p[i*4+1]+.11*p[i*4+2];
      for (let i = 0; i < values.length; i++) {
        const j = i*4, luma = values[i], r = p[j], green = p[j+1], blue = p[j+2];
        const before = values[Math.max(0,i-1)], above = values[Math.max(0,i-cv.width)];
        const border = Math.min(before, above);
        const edge = Math.max(0, luma - border);
        const originalAlpha = p[j+3] / 255;
        const reflect = warm ? clamp((green-49)/116) * clamp((r-green+40)/108) : clamp((luma-96)/125) * clamp((blue-r+48)/100);
        const mask = clamp(reflect * (.25 + .85 * clamp(edge/30)) + .32 * clamp((luma-166)/65));
        p[j]=warm?255:181; p[j+1]=warm?213:235; p[j+2]=warm?163:255;
        p[j+3]=Math.round(originalAlpha * mask * 255);
      }
      g.putImageData(bitmap,0,0);
      textures.push({cv,x,y,w,h});
    }
    cache.set(photo,textures); return textures;
  }
  function shimmer(ctx, time, photo, warm) {
    const maps = highlights(photo,warm);
    ctx.save(); ctx.globalCompositeOperation='screen';
    for(let i=0; i<maps.length; i++) {
      const {cv,x,y,w,h} = maps[i];
      const period=(warm?6.8:5.6)+i*1.53;
      const cycle=(time/period + hash(i+12))%1, active = warm ? .40 : .72;
      if(cycle>=active) continue;
      const u=cycle/active, strength=Math.sin(Math.PI*u);
      for(let j=0;j<18;j++) {
        const a=Math.floor(j*cv.width/18), b=Math.floor((j+1)*cv.width/18);
        const head=1.35*u-.16, d=((j+.5)/18-head)*4.7;
        const light=Math.exp(-d*d)*strength*(warm?.53:.39);
        if(light<.009 || a===b) continue;
        ctx.globalAlpha=light;
        ctx.drawImage(cv,a,0,b-a,cv.height,x+w*a/cv.width,y,w*(b-a)/cv.width,h);
      }
    }
    ctx.restore();
  }

  function glacierMist(ctx,t) {
    // Cold vapour rises off the back and right-hand water. Left-hand foreground moraine stays clear.
    const wisps=[
      [.408,.640,.27,.025,.012,.15,1], [.633,.656,.37,.032,.023,.14,2],
      [.848,.672,.31,.025,.023,.139,3], [.696,.699,.36,.032,.029,.099,1]
    ];
    ctx.save();
    ctx.globalCompositeOperation='screen';
    for (let i=0;i<wisps.length;i++) {
      const [cx,cy,w,h,drift,opacity,seed]=wisps[i];
      const a=t*(.235-.028*i)+seed, b=t*(.105+i*.009)+seed*2.3;
      const x=cx+drift*Math.sin(a), y=cy+.0024*Math.sin(b)-h*.49;
      ctx.globalAlpha=opacity*(.76+.24*Math.sin(.88*b));
      ctx.drawImage(cloudSprite(false,seed),x-w/2,y-h*.5,w,h*(1+.16*Math.sin(a*.67)));
    }
    ctx.restore();
  }

  const scree = [
    // Eroded shelf, fall distance, horizontal drift, idle interval, initial phase.
    [.300,.365,.141,.020,7.1,1.3], [.693,.294,.168,-.035,9.0,3.9],
    [.796,.468,.134,-.033,10.7,6.5], [.273,.594,.108,.030,12.3,3.2]
  ];
  function stoneDust(ctx,time) {
    ctx.save();
    for(let i=0;i<scree.length;i++) {
      const [x,y,fall,drift,period,offset]=scree[i];
      const cycle=Math.floor((time+offset)/period);
      const age=(time+offset)%period - hash(cycle+i*16)*1.1;
      if(age<0 || age>4.1) continue;
      const u=age/4.1, phase=hash(cycle*3.7+i)*tau;
      // Dust leaves the underside of a ledge, disperses in the shaft and settles downslope.
      const sx=x+drift*u+.006*Math.sin(u*4+phase)*u, sy=y+fall*(.35*u+.65*u*u);
      const w=.020+.092*u,h=.019+.044*u;
      ctx.globalAlpha=.28*Math.sin(u*Math.PI);
      ctx.drawImage(cloudSprite(true,1+i%3),sx-w*.5,sy-h*.44,w,h);
      for(let j=0;j<7;j++){
        const seed=cycle*93+i*18+j*4.19;
        const v=(age-.83*hash(seed+.94))/(1.22+.94*hash(seed+5.61));
        if(v<0 || v>1) continue;
        const dx=x+(hash(seed+2.12)-.5)*(.005+.032*v)+drift*v*.63;
        const dy=y+fall*(.18*v+.78*v*v)*( .67+.35*hash(seed+3.51));
        const size=.0008+.00125*hash(seed+.7), gain=(.42+.44*hash(seed+4.11))*Math.sin(Math.PI*v);
        ctx.globalAlpha=gain;
        ctx.fillStyle=j%3===0?'#d79c71':'#9b6951';
        ctx.beginPath();ctx.moveTo(dx-size,dy-size*.39);ctx.lineTo(dx+size*.46,dy-size*.65);ctx.lineTo(dx+size*.68,dy+size*.80);ctx.lineTo(dx-size*.46,dy+size*.45);ctx.closePath();ctx.fill();
      }
    }
    ctx.restore();
  }

  function draw(ctx,key,timeSeconds,photo) {
    if(!photo || !photo.naturalWidth || !photo.naturalHeight || !Number.isFinite(timeSeconds)) return;
    ctx.save();
    if(key==='ice'){
      moveWater(ctx,timeSeconds,photo,water.ice);
      strikeWater(ctx,timeSeconds);
    }else if(key==='lake'){
      moveWater(ctx,timeSeconds,photo,water.lake);
      glacierMist(ctx,timeSeconds);
      shimmer(ctx,timeSeconds,photo,false);
    }else if(key==='carnelian'){
      stoneDust(ctx,timeSeconds);
      shimmer(ctx,timeSeconds,photo,true);
    }
    ctx.restore();
  }
  KF.CavernMotion={draw};
})(globalThis.KF=globalThis.KF||{});

// One moving surface follows the same object-fit rectangle as the room photograph.
(function (KF) {
  'use strict';

  function create() {
    const root = document.getElementById('kf-atmosphere');
    const plate = root.querySelector('.motion-plate');
    const canvas = plate.querySelector('[data-layer="environment"]');
    const surface = plate.querySelector('[data-layer="water"]');
    const brush = canvas.getContext('2d');
    let viewportWidth = 0, viewportHeight = 0;
    let photo = null, theme = null, water, dirty = true;

    function layout() {
      if (!photo || !viewportWidth || !viewportHeight) return;
      const scale = Math.max(viewportWidth / photo.naturalWidth, viewportHeight / photo.naturalHeight);
      const width = photo.naturalWidth * scale;
      const height = photo.naturalHeight * scale;
      const left = (viewportWidth - width) * theme.focusX / 100;
      const top = (viewportHeight - height) * theme.focusY / 100;
      plate.style.width = width + 'px';
      plate.style.height = height + 'px';
      plate.style.left = left + 'px';
      plate.style.top = top + 'px';
      // The underlying photograph remains at native resolution; the soft moving layers
      // can be sampled more coarsely on phones without softening stationary detail.
      const pixelScale = Math.min(window.devicePixelRatio || 1, 1.4, 832 / width, 1040 / height);
      const w = Math.max(2, Math.round(width * pixelScale));
      const h = Math.max(2, Math.round(height * pixelScale));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      dirty = true;
    }

    function draw(time) {
      if (!photo || !brush) return;
      dirty = false;
      const key = theme.key;
      let mode = 'canvas';
      if (key === 'moss') {
        if (water === undefined) water = KF.Water.create(surface);
        mode = water && water.draw(photo, time) ? 'webgl' : 'fallback';
      }
      root.dataset.renderer = mode;
      if (mode === 'webgl') return;

      brush.setTransform(1, 0, 0, 1, 0, 0);
      brush.clearRect(0, 0, canvas.width, canvas.height);
      brush.save();
      brush.setTransform(canvas.width, 0, 0, canvas.height, 0, 0);
      if (key === 'moss') KF.WaterFallback.draw(brush, time, photo);
      else if (key === 'ice' || key === 'carnelian' || key === 'lake') KF.CavernMotion.draw(brush, key, time, photo);
      else KF.MineralMotion.draw(brush, key, time, photo);
      brush.restore();
    }

    surface.addEventListener('webglcontextlost', () => { dirty = true; });
    surface.addEventListener('webglcontextrestored', () => { dirty = true; });
    return {
      resize(w, h) { viewportWidth = w; viewportHeight = h; layout(); },
      select(nextPhoto, nextTheme, fade) {
        photo = nextPhoto;
        theme = nextTheme;
        root.dataset.room = theme.key;
        root.dataset.renderer = '';
        layout();
        if (fade && root.animate) root.animate([{opacity: 0}, {opacity: 1}], {duration: 1000, easing:'ease-in-out'});
      },
      get dirty() { return dirty; },
      draw
    };
  }
  KF.Atmosphere = {create};
})(globalThis.KF = globalThis.KF || {});

// ---- src/cave.js
(function (KF) {
  'use strict';
  const THEMES = JSON.parse(document.getElementById('cave-art').textContent);
  function themeForLevel(level) {
    return THEMES[(Math.max(1, Math.floor(level)) - 1) % THEMES.length];
  }

  function create() {
    const chamber = document.querySelector('.scene-chamber');
    const roomName = document.getElementById('chamber-mineral');
    const levelLabel = document.getElementById('chamber-level');
    const atmosphere = KF.Atmosphere.create();
    let width = 1, height = 1, time = 0, level = 0;
    let currentPhoto = null;
    let transition = null;
    let requestNumber = 0;

    function displayRoom(value, immediate) {
      if (value === level) return;
      level = value;
      const request = ++requestNumber;
      const theme = themeForLevel(value);
      if (roomName) roomName.textContent = theme.name;
      if (levelLabel) levelLabel.textContent = 'LEVEL ' + String(level).padStart(2, '0');
      if (currentPhoto && currentPhoto.dataset.room === theme.key) return;

      const photo = new Image();
      photo.alt = '';
      photo.dataset.room = theme.key;
      photo.style.objectPosition = theme.focusX + '% ' + theme.focusY + '%';
      photo.onload = () => {
        // A restart can select a different room while this photograph is loading.
        if (request !== requestNumber) return;
        const previous = currentPhoto;
        if (transition) { transition.cancel(); transition = null; }
        currentPhoto = photo;
        const fade = previous && !immediate && photo.animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        atmosphere.select(photo, theme, fade);
        if (!fade) {
          chamber.replaceChildren(photo);
          return;
        }
        chamber.replaceChildren(previous, photo);
        transition = photo.animate([{opacity: 0}, {opacity: 1}], {duration: 1000, easing: 'ease-in-out'});
        transition.onfinish = () => {
          previous.remove();
          transition = null;
        };
      };
      photo.src = theme.src;
    }

    const fraction = n => { const v = Math.sin(n * 78.233 + 34.543) * 43758.5453; return v - Math.floor(v); };
    const dust = Array.from({length: 28}, (_, i) => ({
      x: fraction(i + .41), y: fraction(i + 1.31),
      speed: 1.2 + fraction(i + 3.17) * 4, phase: fraction(i + 2.79) * 6.28, r: .45 + fraction(i + 5.51) * .6
    }));
    return {
      resize(w, h) { width = w; height = h; atmosphere.resize(w, h); },
      get dirty() { return atmosphere.dirty; },
      setLevel: displayRoom,
      get level() { return level; },
      update(ms) { time += ms / 1000; },
      draw(ctx, title) {
        if (!title) atmosphere.draw(time);
        ctx.clearRect(0, 0, width, height);
        for (const p of dust) {
          const x = p.x * width + Math.sin(time * .08 + p.phase) * 8;
          const y = (p.y * height + time * p.speed) % height;
          const opacity = .065 + .105 * (.5 + .5 * Math.sin(time * .37 + p.phase));
          ctx.fillStyle = 'rgba(212,224,209,' + opacity.toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(x, y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
  }

  KF.Cave = {THEMES, themeForLevel, create};
})(globalThis.KF = globalThis.KF || {});
