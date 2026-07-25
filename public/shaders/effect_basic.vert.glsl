precision highp float;
precision highp int;

in vec3 position;
in vec2 uv;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float _DepthOffset;
out mediump vec2 vs_TEXCOORD0;

void main()
{
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    viewPosition.z -= _DepthOffset;
    gl_Position = projectionMatrix * viewPosition;
    vs_TEXCOORD0 = uv;
}
