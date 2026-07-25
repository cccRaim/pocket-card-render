precision highp float;
precision highp int;

in vec3 position;
out vec2 vUv;
in vec2 uv;

void main()
{
    gl_Position = vec4(position, 1.0);
    vUv = uv;
}
