precision mediump float;
precision highp int;

uniform mediump sampler2D _242;
uniform mat4 viewMatrix;
uniform vec3 _DarknessColor;
uniform float _DarknessOffset;

in highp vec2 vs_TEXCOORD0;
layout(location = 0) out highp vec4 _267;
layout(location = 1) out highp vec4 _276;

void main()
{
    vec3 darkDir = normalize(-viewMatrix[2].xyz);
    float darkAngle = atan(length(darkDir.xy), darkDir.z);
    float darkWave = sin(darkAngle * 3.0);
    darkWave *= darkWave;
    float darkMask = darkWave * (1.0 - clamp(-_DarknessOffset, 0.0, 1.0));
    vec4 t = texture(_242, vs_TEXCOORD0);
    vec3 rgb = mix(t.rgb, t.rgb * _DarknessColor, darkMask);
    _267 = vec4(rgb, t.a);
    _276 = vec4(0.0);
}
