precision mediump float;
precision highp int;

uniform highp vec3 cameraPosition;
uniform float _BaseColorIntensity;
uniform float _Shininess;
uniform float _SpecularIntensity;
uniform float _MetalMaskIntensity;
uniform vec3 _Rotation;
uniform mediump samplerCube _CubeMap;
uniform mediump sampler2D _MetalMaskTex;

in highp vec2 vs_TEXCOORD0;
in highp vec3 vs_TEXCOORD1;
in highp vec3 vs_TEXCOORD2;
layout(location = 0) out highp vec4 _299;
layout(location = 1) out highp vec4 _305;

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
    vec3 viewDirection = rotateXYZ(normalize(cameraPosition - vs_TEXCOORD1), _Rotation);
    vec3 worldNormal = rotateXYZ(normalize(vs_TEXCOORD2), _Rotation);
    vec3 reflected = reflect(-viewDirection, worldNormal);
    float grazing = pow(clamp(-reflected.z, 0.0, 1.0), _Shininess);
    vec3 environment = texture(_CubeMap, reflected).rgb;
    vec3 reflection = environment * grazing * _SpecularIntensity + vec3(_BaseColorIntensity) - vec3(1.0);
    float mask = texture(_MetalMaskTex, vs_TEXCOORD0).r * _MetalMaskIntensity;
    _299 = vec4(vec3(1.0) + mask * reflection, 1.0);
    _305 = vec4(0.0);
}
