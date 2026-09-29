// 简单的颜色反转着色器
precision mediump float;
varying vec2 v_texcoord;
uniform sampler2D tex;

void main() {
    vec4 texColor = texture2D(tex, v_texcoord);
    gl_FragColor = vec4(1.0 - texColor.rgb, texColor.a);
}

