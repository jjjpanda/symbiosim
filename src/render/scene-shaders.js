const transform = `
uniform mat4 uCamera;
uniform vec2 uTilt;
uniform vec2 uTiltDirection;
vec3 orientNormal(vec3 p) {
  float along=dot(p.xz,uTiltDirection);
  vec2 horizontal=p.xz+uTiltDirection*(along*(uTilt.x-1.)+p.y*uTilt.y);
  return vec3(horizontal.x,-along*uTilt.y+p.y*uTilt.x,horizontal.y);
}
vec3 orient(vec3 p) { return orientNormal(p-vec3(0.,.6666667,0.))+vec3(0.,.6666667,0.); }
`;
export const meshVertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec4 aColor;
layout(location=3) in float aMaterial;
layout(location=4) in vec2 aUV;
${transform}
out vec3 vPosition; out vec3 vNormal; out vec4 vColor; out vec2 vUV;
uniform float uWater;
out float vImmersion;
flat out int vMaterial;
void main() {
  vPosition=orient(aPosition); vNormal=orientNormal(aNormal); vColor=aColor; vUV=aUV;
  vMaterial=int(aMaterial+.5); gl_Position=uCamera*vec4(vPosition,1.);
  vImmersion=max(0.,uWater-aPosition.y);
}`;
export const meshFragment = `#version 300 es
precision highp float;
in vec3 vPosition; in vec3 vNormal; in vec4 vColor; in vec2 vUV;
in float vImmersion;
flat in int vMaterial;
uniform vec3 uEye; uniform vec3 uBackground;
uniform sampler2D uBackdrop; uniform vec2 uViewport;
uniform float uWater; uniform float uRefract;
out vec4 color;
float noise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  vec4 h=fract(sin(vec4(dot(i,vec2(127.1,311.7)),dot(i+vec2(1,0),vec2(127.1,311.7)),dot(i+vec2(0,1),vec2(127.1,311.7)),dot(i+1.,vec2(127.1,311.7))))*43758.5453);
  return mix(mix(h.x,h.y,f.x),mix(h.z,h.w,f.x),f.y);
}
vec3 environment(vec3 r) {
  float sky=smoothstep(-.35,.8,r.y);
  vec3 room=mix(uBackground*.65,uBackground*1.1+vec3(.02),sky);
  // Tall studio cards remain visible in the cylindrical wall's reflected
  // directions, including below the horizon when viewing the jar from above.
  float window=exp(-pow(abs(r.x+.75*r.z)/.10,4.))*smoothstep(0.,.4,r.z)*(1.-smoothstep(.75,1.,abs(r.y)));
  float strip=exp(-pow(abs(r.x-1.4*r.z)/.055,2.))*smoothstep(0.,.4,r.z);
  return room+vec3(1.,.97,.86)*window*1.6+vec3(.75,.91,1.)*strip*.9;
}
void main() {
  vec3 eye=normalize(uEye-vPosition), n=normalize(vNormal);
  if(dot(n,eye)<0.) n=-n;
  float facing=clamp(dot(n,eye),0.,1.);
  vec3 reflected=environment(reflect(-eye,n));
  vec3 lightDir=normalize(vec3(-.7,1.4,.9));
  float diffuse=.32+.68*max(0.,dot(n,lightDir));
  vec3 base=vColor.rgb; float alpha=vColor.a;
  float spec=pow(max(0.,dot(reflect(-lightDir,n),eye)),70.);
  if(vMaterial==1 || vMaterial==2 || vMaterial==5) {
    float fresnel=.035+.965*pow(1.-facing,5.);
    float bend=vMaterial==1?.0035:vMaterial==2?.0028:.0055;
    vec4 back=texture(uBackdrop,clamp(gl_FragCoord.xy/uViewport+n.xy*bend,vec2(.001),vec2(.999)));
    vec3 behind=back.rgb+uBackground*(1.-back.a);
    // Absorb light through tea using Beer-Lambert extinction derived from the
    // pH-dependent (or thermal-overlay) liquid color while preserving cell contrast.
    if(vMaterial==2) {
      vec3 absorb=max(vec3(.04),-log(clamp(base,vec3(.025),vec3(.96))));
      behind=mix(behind*exp(-absorb*(.26+.52*facing)),base*(.56+.44*diffuse),.28);
    }
    if(vMaterial==5) {
      vec3 absorb=max(vec3(.04),-log(clamp(base,vec3(.035),vec3(.96))));
      behind=mix(behind*exp(-absorb*(.32+.45*facing)),base*(.64+.42*diffuse),.46);
    }
    // Alpha blending applies opacity once more. Normalize the reflected and
    // refracted contributions here so it does not dim Fresnel a second time.
    float transmission=(1.-fresnel)*alpha;
    float opacity=fresnel+transmission;
    vec3 light=(behind*transmission+reflected*fresnel)/max(.001,opacity);
    if(uRefract<.5) light=mix(base,reflected,.35+fresnel*.4);
    float specBoost=vMaterial==5?.88:.5;
    color=vec4(light+spec*specBoost/max(.001,opacity),opacity); return;
  }
  if(vMaterial==3) {
    float grain=noise(vUV*85.), fibrils=pow(noise(vec2(vUV.x*45.+grain,vUV.y*260.)),4.5);
    float radial=length(vUV-.5)*2., rings=.5+.5*sin(radial*22.+grain*3.5);
    float wrap=.42+.58*clamp((dot(n,lightDir)+.45)/1.45,0.,1.);
    base*=.86+.18*noise(vUV*12.)+grain*.07+rings*.04;
    base+=fibrils*.085+vec3(.12,.09,.04)*pow(1.-facing,3.)*exp(-vImmersion*4.);
    base*=exp(-vec3(.45,1.8,4.6)*vImmersion);
    color=vec4(base*wrap+spec*.38*exp(-vImmersion*5.),alpha); return;
  }
  if(vMaterial==4) {
    float fresnel=.02+.98*pow(1.-facing,5.);
    color=vec4(mix(base,reflected,.4)+spec*.9,.18+fresnel*.65); return;
  }
  if(vMaterial==6) { color=vec4(base,alpha); return; }
  if(vMaterial==7) {
    float fresnel=.12+.88*pow(1.-facing,4.);
    vec3 steel=base*(.38+.42*diffuse)+reflected*(.22+.35*fresnel);
    color=vec4(steel+spec*.55,alpha); return;
  }
  color=vec4(base*diffuse+spec*.35,alpha);
}`;
export const particleVertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec4 aColor;
layout(location=2) in float aSize;
layout(location=3) in float aKind;
${transform}
uniform float uRatio;
out vec4 vColor; out float vKind;
void main() {
  gl_Position=uCamera*vec4(orient(aPosition),1.);
  gl_PointSize=clamp(aSize*uRatio*3.8/gl_Position.w,1.8*uRatio,(aKind>1.5?46.:25.)*uRatio);
  vColor=aColor; vKind=aKind;
}`;
export const particleFragment = `#version 300 es
precision highp float;
in vec4 vColor; in float vKind; out vec4 color;
void main() {
  vec2 p=(gl_PointCoord-.5)*2.;
  if(vKind<-.5) { float a=-vKind*6.283185; p=mat2(cos(a),-sin(a),sin(a),cos(a))*p; p.x*=2.35; }
  float r=length(p); if(r>1. || vColor.a<.01) discard;
  float rim=1.-smoothstep(.35,.82,r);
  if(vKind>2.5) {
    float ring=smoothstep(.70,.79,r)*(1.-smoothstep(.88,.98,r));
    color=vec4(vColor.rgb,vColor.a*ring); return;
  }
  if(vKind>1.5) { color=vec4(vColor.rgb,vColor.a*exp(-r*r*3.1)); return; }
  if(vKind>.5) {
    vec3 n=vec3(p.x,-p.y,sqrt(max(0.,1.-r*r)));
    float fresnel=.035+.965*pow(1.-n.z,3.6);
    float glint=pow(max(0.,dot(n,normalize(vec3(-.42,.58,.7)))),28.)+.35*pow(max(0.,dot(n,normalize(vec3(.45,-.5,.72)))),18.);
    color=vec4(mix(vColor.rgb,vec3(.9,.98,1.),fresnel)+glint*.82,(.16+fresnel*.72+glint*.52)*vColor.a); return;
  }
  float core=exp(-dot(p-vec2(-.18,.18),p-vec2(-.18,.18))*4.2);
  color=vec4(vColor.rgb*(.74+.42*rim)+vec3(.22,.2,.14)*core,vColor.a*(1.-smoothstep(.68,1.,r)));
}`;
