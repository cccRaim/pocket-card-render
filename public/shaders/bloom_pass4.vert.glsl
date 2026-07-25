precision highp float;
precision highp int;

in vec3 position;
out vec4 vColor;
in vec4 color;
out vec3 vUv;
in vec3 uvw;

void main()
{
    gl_Position = vec4(position, 1.0);
    vColor = color;
    vUv = uvw;
}
