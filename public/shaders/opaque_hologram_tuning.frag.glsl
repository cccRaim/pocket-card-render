precision mediump float;
precision highp int;

uniform highp vec3 cameraPosition;
uniform highp mat4 viewMatrix;
uniform float _Shininess;
uniform float _BaseColorIntensity;
uniform float _SpecularIntensity;
uniform float _DiffractionIntensity;
uniform float _DiffractionPower;
uniform float _RampRepeat;
uniform float _RampSpeed;
uniform float _RampOffset;
uniform float _RampInterval;
uniform vec3 _Rotation;
uniform mediump sampler2D _PhaseTex;
uniform mediump sampler2D _RampMaskTex;
uniform mediump sampler2D _RampTex;
uniform mediump samplerCube _CubeMap;
uniform mediump sampler2D _MainTex;
uniform mediump sampler2D _HologramMaskTex;

in highp vec2 vs_TEXCOORD0;
in highp vec3 vs_TEXCOORD1;
in highp vec3 vs_TEXCOORD2;
layout(location = 0) out highp vec4 _603;
layout(location = 1) out highp vec4 _611;

vec3 rotateXYZ(vec3 v, vec3 degrees)
{
    vec3 r = degrees * -0.01745329238474369;
    float cx = cos(r.x), sx = sin(r.x);
    float cy = cos(r.y), sy = sin(r.y);
    float cz = cos(r.z), sz = sin(r.z);
    v.yz = vec2(cx * v.y - sx * v.z, sx * v.y + cx * v.z);
    v.xz = vec2(cy * v.x + sy * v.z, -sy * v.x + cy * v.z);
    v.xy = vec2(cz * v.x - sz * v.y, sz * v.x + cz * v.y);
    return v;
}

void main()
{
    vec4 phase = texture(_PhaseTex, vs_TEXCOORD0);
    vec2 phaseCenter = vec2(phase.x * 0.25 + 0.25, (2.0 - phase.y) * 0.25 + 0.25);
    vec3 cameraForward = normalize(vec3(-viewMatrix[0][2], -viewMatrix[1][2], -viewMatrix[2][2]));
    vec3 rotatedView = rotateXYZ(cameraForward, _Rotation) * 0.5 + 0.5;
    vec3 rotatedNormal = rotateXYZ(normalize(vs_TEXCOORD2), _Rotation) * 0.5 + 0.5;
    float normalView = dot(rotatedNormal.xy, rotatedView.xy);
    vec2 diffractionPair = pow(1.0 - min(abs(vec2(normalView) - phaseCenter), vec2(1.0)), vec2(_DiffractionPower)) * phase.zw;
    float diffraction = diffractionPair.x + diffractionPair.y;
    float rampMask = texture(_RampMaskTex, vs_TEXCOORD0).r;
    float rampU = clamp(fract((dot(rotatedNormal * _RampSpeed, rotatedView) - rampMask) * _RampRepeat + _RampOffset) * (_RampInterval + 1.0) - _RampInterval * 0.5, 0.0, 1.0);
    vec3 hologram = texture(_RampTex, vec2(rampU, 0.5)).rgb * diffraction * _DiffractionIntensity;

    vec3 viewDirection = rotateXYZ(normalize(cameraPosition - vs_TEXCOORD1), _Rotation);
    vec3 worldNormal = rotateXYZ(normalize(vs_TEXCOORD2), _Rotation);
    vec3 reflected = reflect(-viewDirection, worldNormal);
    vec3 environment = texture(_CubeMap, reflected).rgb;
    float grazing = pow(clamp(-reflected.z, 0.0, 1.0), _Shininess) * _SpecularIntensity;
    vec4 base = texture(_MainTex, vs_TEXCOORD0);
    vec3 shaded = base.rgb * (vec3(_BaseColorIntensity) + environment * grazing) + hologram;
    float hologramMask = texture(_HologramMaskTex, vs_TEXCOORD0).r;
    _603 = vec4(mix(base.rgb, shaded, hologramMask), base.a);
    _611 = vec4(0.0);
}
