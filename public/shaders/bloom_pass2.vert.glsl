precision highp float;
precision highp int;

in vec3 position;
out vec3 vUv;
in vec3 uvSelector;

void main()
{
    gl_Position = vec4(position, 1.0);
    vUv = uvSelector;
}
