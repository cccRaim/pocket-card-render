precision mediump float;
precision highp int;
uniform highp vec3 cameraPosition;
uniform highp mat4 viewMatrix;
uniform highp vec3 _AreaAColorOklab;
uniform highp vec3 _AreaBColorOklab;
uniform highp vec3 _UIColorROklab;
uniform highp vec3 _UIColorGOklab;
uniform float _UIHoloMaskR;
uniform float _UIHoloMaskG;
uniform float _UIMetallicMaskR;
uniform float _UIMetallicMaskG;
uniform int _UseUIMaskLeftTopAdjust;
uniform highp float _UIMaskLeftTopPow;
uniform highp vec2 _UILeftTopUV;
uniform highp float _UIAdjustThreshold;
uniform highp float _A_HologramFrontMaskOnAll;
uniform highp float _A_HologramFrontMask;
uniform highp float _A_DiffractionIntensity;
uniform highp float _A_DiffractionPower;
uniform highp float _A_RampRepeat;
uniform highp float _A_RampAlphaRepeat;
uniform highp float _A_RampSpeed;
uniform highp float _A_RampOffset;
uniform highp float _A_RampInterval;
uniform highp float _A_RampUVOffset;
uniform highp float _A_CardTiltOffset;
uniform int _A_UseRampFade;
uniform highp float _A_RampFadeLength;
uniform highp float _A_MaskPower;
uniform highp float _A_FrontMaskRangeUVY;
uniform highp float _A_FrontMaskRangeSmooth;
uniform highp float _A_Blend_AlphaBlend;
uniform highp float _A_Blend_AlphaBlendScaleByDist;
uniform highp float _A_Blend_Add;
uniform highp float _A_Blend_Emissive;
uniform highp float _B_HologramFrontMaskOnAll;
uniform highp float _B_HologramFrontMask;
uniform highp float _B_DiffractionIntensity;
uniform highp float _B_DiffractionPower;
uniform highp float _B_RampRepeat;
uniform highp float _B_RampAlphaRepeat;
uniform highp float _B_RampSpeed;
uniform highp float _B_RampOffset;
uniform highp float _B_RampInterval;
uniform highp float _B_RampUVOffset;
uniform highp float _B_CardTiltOffset;
uniform highp float _B_MaskPower;
uniform highp float _B_FrontMaskRangeUVY;
uniform highp float _B_FrontMaskRangeSmooth;
uniform int _B_OneStripeBlockCount;
uniform int _B_ZureBlockCount;
uniform int _B_StripeLoopLength;
uniform highp float _B_RampLoopLength;
uniform highp float _B_Blend_AlphaBlend;
uniform highp float _B_Blend_AlphaBlendScaleByDist;
uniform highp float _B_Blend_Add;
uniform highp float _B_Blend_Emissive;
uniform highp float _OverExposurePow;
uniform highp float _OverExposureEmissiveIntensity;
uniform int _OneStripeBlockCount;
uniform int _ZureBlockCount;
uniform int _StripeLoopLength;
uniform highp float _RampLoopLength;
uniform highp float _A_HoloCrossPower;
uniform highp float _B_HoloCrossPower;
uniform highp float _A_InnerBlockDiffractionIntensity;
uniform highp float _A_InnerBlockDiffractionPower;
uniform highp float _A_InnerBlockDiffractionWidthPower;
uniform highp float _A_InnerBlockRampOffsetScale;
uniform int _A_InnerBlockPosOffsetX;
uniform int _A_InnerBlockPosOffsetY;
uniform highp float _B_InnerBlockDiffractionIntensity;
uniform highp float _B_InnerBlockDiffractionPower;
uniform highp float _B_InnerBlockDiffractionWidthPower;
uniform highp float _B_InnerBlockRampOffsetScale;
uniform highp vec3 _A_Multi1LightDir;
uniform int _A_Multi1StripePosOffsetX;
uniform int _A_Multi1StripePosOffsetY;
uniform highp float _A_Multi1DiffractionIntensityRatio;
uniform highp vec3 _B_Multi1LightDir;
uniform int _B_Multi1StripePosOffsetX;
uniform int _B_Multi1StripePosOffsetY;
uniform highp float _B_Multi1DiffractionIntensityRatio;
uniform float _BaseColorIntensity;
uniform float _MetallicShininess;
uniform float _MetallicSpecularIntensity;
uniform highp float _EmissiveFrontMask;
uniform highp float _EmissiveFrontMaskPower;
uniform highp float _A_InnerBlockUseRampAlpha;
uniform vec3 _Rotation;
uniform mediump sampler2D _13;
uniform mediump sampler2D _26;
uniform mediump sampler2D _1227;
uniform mediump sampler2D _3134;

in highp vec4 vs_TEXCOORD0;
in highp vec3 vs_TEXCOORD2;
in highp vec3 vs_TEXCOORD1;
in highp vec4 vs_TEXCOORD3;
in highp vec4 vs_TEXCOORD4;
layout(location = 1) out highp vec4 _5198;
layout(location = 0) out highp vec4 _5205;
highp vec4 _9;
vec2 _25;
highp float _33;
highp vec3 _43;
highp float _71;
bool _79;
highp vec2 _86;
highp vec2 _133;
highp vec3 _243;
highp vec4 _260;
highp vec4 _345;
bvec3 _375;
highp vec4 _383;
highp vec4 _484;
highp vec4 _498;
highp vec4 _511;
highp vec4 _528;
highp vec4 _533;
highp vec4 _561;
highp vec4 _566;
highp vec4 _626;
bvec2 _691;
int _702;
int _707;
highp float _729;
bvec4 _800;
highp float _875;
highp vec2 _891;
bvec2 _897;
highp float _956;
highp float _971;
vec3 _1002;
highp float _1007;
highp float _1036;
vec2 _1056;
highp vec2 _1203;
highp vec4 _1219;
float _1226;
vec3 _1233;
vec3 _1245;
float _1251;
highp float _1257;
highp vec3 _1287;
highp float _1304;
highp vec4 _1395;
highp vec3 _1410;
highp vec2 _1417;
vec4 _1528;
highp vec4 _1553;
highp vec4 _1611;
highp vec4 _1658;
bvec4 _1760;
highp vec4 _1818;
bvec2 _1848;
highp vec2 _1878;
vec3 _1947;
vec2 _1957;
vec2 _1992;
vec3 _2116;
highp vec2 _2123;
float _2125;
highp float _2169;
highp vec3 _2192;
highp vec3 _2225;
vec3 _2364;
vec3 _2441;
vec3 _2480;
ivec3 _2640;
bvec4 _2731;
bvec2 _2825;
float _3133;
vec3 _3151;
float _3157;
highp vec2 _3304;
highp vec2 _3406;
vec3 _3408;
bvec4 _3639;
bvec2 _3729;
vec3 _3984;
vec3 _3990;
highp vec2 _3997;
vec3 _4219;
highp vec3 _4781;
bvec3 _5010;
bool _5039;

const highp mat4 pcrUnityFromThreeWorld = mat4(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
const highp mat4 pcrUnityFromGlbObject = mat4(-1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
highp vec2 pcrStoredUv(highp vec2 value) { return vec2(value.x, 1.0 - value.y); }
void main() {
    highp mat4 pcrUnityInput_viewMatrix = viewMatrix * pcrUnityFromThreeWorld;
    highp vec3 pcrUnityInput_cameraPosition = vec3(cameraPosition.xy, -cameraPosition.z);

    vec2 _21 = texture(_13, pcrStoredUv( vs_TEXCOORD0.xy)).xy;
    _9 = vec4(_21.x, _21.y, _9.z, _9.w);
    _25 = texture(_26, pcrStoredUv( vs_TEXCOORD0.xy)).xw;
    _33 = (-_25.y) + 1.0;
    _43.x = log2(_25.x);
    _43.x *= _UIMaskLeftTopPow;
    _43.x = exp2(_43.x);
    _43.x = min(_43.x, 1.0);
    _71 = float(_UseUIMaskLeftTopAdjust);
    _79 = _UIAdjustThreshold >= _25.x;
    _86.x = float(_79);
    _71 = _86.x * _71;
    _79 = _UILeftTopUV.x >= vs_TEXCOORD0.x;
    _86.x = float(_79);
    _71 = _86.x * _71;
    _86.x = (-_UILeftTopUV.y) + 1.0;
    _79 = vs_TEXCOORD0.y >= _86.x;
    _86.x = float(_79);
    _71 = _86.x * _71;
    _43.x = (-_25.x) + _43.x;
    _133.x = (_71 * _43.x) + _25.x;
    _43.x = _33 * _33;
    _43.x *= _43.x;
    _43.x *= _43.x;
    _43.x *= _43.x;
    _43.x *= _43.x;
    _43.x *= _43.x;
    _43.x *= _43.x;
    _43.x *= _43.x;
    _133.x = (-_133.x) + 1.0;
    _133.x = _43.x * _133.x;
    _33 = _33;
    _33 = clamp(_33, 0.0, 1.0);
    vec2 _208 = vec2(_UIHoloMaskG, _UIMetallicMaskG);
    highp vec2 hp_copy_208 = _208;
    highp vec2 _211 = hp_copy_208 + vec2(-1.0);
    _43 = vec3(_211.x, _211.y, _43.z);
    highp vec2 _220 = (vec2(_33) * _43.xy) + vec2(1.0);
    _43 = vec3(_220.x, _220.y, _43.z);
    _86 = (-_43.xy) + vec2(_UIHoloMaskR, _UIMetallicMaskR);
    highp vec2 _240 = (_133.xx * _86) + _43.xy;
    _43 = vec3(_240.x, _240.y, _43.z);
    _243 = _AreaAColorOklab + (-_AreaBColorOklab);
    _243 = (_9.xxx * _243) + _AreaBColorOklab;
    highp vec3 _266 = (-_243) + _UIColorGOklab;
    _260 = vec4(_266.x, _266.y, _266.z, _260.w);
    _243 = (vec3(_33) * _260.xyz) + _243;
    highp vec3 _281 = (-_243) + _UIColorROklab;
    _260 = vec4(_281.x, _281.y, _281.z, _260.w);
    _243 = (_133.xxx * _260.xyz) + _243;
    _260.x = dot(_243, vec3(1.0, 0.3963377773761749267578125, 0.21580375730991363525390625));
    _260.y = dot(_243, vec3(1.0, -0.1055613458156585693359375, -0.06385417282581329345703125));
    _260.z = dot(_243, vec3(1.0, -0.089484177529811859130859375, -1.2914855480194091796875));
    _243 = _260.xyz * _260.xyz;
    _243 = _260.xyz * _243;
    _260.x = dot(_243, vec3(4.076741695404052734375, -3.30771160125732421875, 0.2309699356555938720703125));
    _260.y = dot(_243, vec3(-1.26843798160552978515625, 2.60975742340087890625, -0.341319382190704345703125));
    _260.z = dot(_243, vec3(-0.0041960864327847957611083984375, -0.70341861248016357421875, 1.7076146602630615234375));
    _243 = _260.xyz * vec3(12.9200000762939453125);
    highp vec3 _348 = log2(_260.xyz);
    _345 = vec4(_348.x, _348.y, _348.z, _345.w);
    highp vec3 _355 = _345.xyz * vec3(0.4166666567325592041015625);
    _345 = vec4(_355.x, _355.y, _355.z, _345.w);
    highp vec3 _360 = exp2(_345.xyz);
    _345 = vec4(_360.x, _360.y, _360.z, _345.w);
    highp vec3 _370 = (_345.xyz * vec3(1.05499994754791259765625)) + vec3(-0.054999999701976776123046875);
    _345 = vec4(_370.x, _370.y, _370.z, _345.w);
    _375 = greaterThanEqual(_260.xyzx, vec4(0.003130800090730190277099609375, 0.003130800090730190277099609375, 0.003130800090730190277099609375, 0.0)).xyz;
    _383.x = float(_375.x);
    _383.y = float(_375.y);
    _383.z = float(_375.z);
    highp vec3 _402 = ((-_260.xyz) * vec3(12.9200000762939453125)) + _345.xyz;
    _260 = vec4(_402.x, _402.y, _402.z, _260.w);
    _243 = (_383.xyz * _260.xyz) + _243;
    highp vec3 _419 = (-vs_TEXCOORD2) + pcrUnityInput_cameraPosition;
    _260 = vec4(_419.x, _419.y, _419.z, _260.w);
    _133.x = dot(_260.xyz, _260.xyz);
    _133.x = inversesqrt(_133.x);
    highp vec3 _436 = _133.xxx * _260.xyz;
    _260 = vec4(_436.x, _436.y, _436.z, _260.w);
    _133.x = dot(vs_TEXCOORD1, vs_TEXCOORD1);
    _133.x = inversesqrt(_133.x);
    highp vec3 _451 = _133.xxx * vs_TEXCOORD1;
    _345 = vec4(_451.x, _451.y, _451.z, _345.w);
    _383.x = -pcrUnityInput_viewMatrix[0].z;
    _383.y = -pcrUnityInput_viewMatrix[1].z;
    _383.z = -pcrUnityInput_viewMatrix[2].z;
    _133.x = dot(_383.xyz, _383.xyz);
    _133.x = inversesqrt(_133.x);
    highp vec3 _481 = _133.xxx * _383.xyz;
    _383 = vec4(_481.x, _481.y, _481.z, _383.w);
    vec3 _492 = vec3(_Rotation.x, _Rotation.y, _Rotation.z);
    highp vec3 hp_copy_492 = _492;
    highp vec3 _495 = hp_copy_492 * vec3(-0.01745329238474369049072265625);
    _484 = vec4(_495.x, _495.y, _495.z, _484.w);
    _498.x = cos(_484.x);
    _484.x = sin(_484.x);
    _498.y = -_484.x;
    _511.y = dot(_498.xy, _383.yz);
    _498.z = _484.x;
    _383.w = dot(_498.zx, _383.yz);
    _528.x = sin(_484.y);
    _533.x = cos(_484.y);
    _533.y = _528.x;
    _511.x = dot(_533.xy, _383.xw);
    highp vec2 _549 = -_528.xx;
    _528 = vec4(_549.x, _528.y, _528.z, _549.y);
    _528.z = _533.x;
    _383.z = dot(_528.xz, _383.xw);
    _561.x = sin(_484.z);
    _566.x = cos(_484.z);
    _566.y = -_561.x;
    _383.x = dot(_566.xy, _511.xy);
    _566.z = _561.x;
    _383.y = dot(_566.zx, _511.xy);
    _511.x = _498.x;
    highp vec2 _595 = -_484.xx;
    _511 = vec4(_511.x, _595.x, _511.z, _595.y);
    _484.y = dot(_511.xy, _260.yz);
    _260.w = dot(_498.zx, _260.yz);
    _484.x = dot(_533.xy, _260.xw);
    _528 = vec4(_528.xz.x, _528.xz.y, _528.z, _528.w);
    _260.z = dot(_528.wy, _260.xw);
    _626.x = _566.x;
    highp vec2 _632 = -_561.xx;
    _626 = vec4(_626.x, _632.x, _626.z, _632.y);
    _260.x = dot(_626.xy, _484.xy);
    _260.y = dot(_566.zx, _484.xy);
    _511.z = _511.x;
    _484.y = dot(_511.zw, _345.yz);
    _345.w = dot(_498.zx, _345.yz);
    _484.x = dot(_533.xy, _345.xw);
    _345.z = dot(_528.xy, _345.xw);
    _626.z = _626.x;
    _345.x = dot(_626.zw, _484.xy);
    _345.y = dot(_566.zx, _484.xy);
    _691 = lessThan(vec4(0.0), _9.xyxy).xy;
    if (_691.x)
    {
        _702 = int(_RampLoopLength);
        _707 = (_StripeLoopLength * _OneStripeBlockCount) + _ZureBlockCount;
        _702 *= _OneStripeBlockCount;
        _133.x = float(_702);
        _86.x = float(_707);
        _729 = float(_OneStripeBlockCount);
        highp vec3 _739 = (vs_TEXCOORD3.xyy * vec3(1.0, 1.0, -1.0)) + vec3(0.0, 0.0, 1.0);
        _484 = vec4(_739.x, _739.y, _739.z, _484.w);
        highp vec3 _746 = vec3(_729) * _484.xyz;
        _484 = vec4(_746.x, _746.y, _746.z, _484.w);
        highp vec3 _751 = floor(_484.xyz);
        _484 = vec4(_751.x, _751.y, _751.z, _484.w);
        highp vec3 _764 = vec3(ivec3(_A_InnerBlockPosOffsetX, _A_InnerBlockPosOffsetY, _A_InnerBlockPosOffsetY));
        _498 = vec4(_764.x, _764.y, _764.z, _498.w);
        highp vec3 _771 = _484.xyz + _498.xyz;
        _511 = vec4(_771.x, _771.y, _771.z, _511.w);
        _484 = (_484.yxyx * vec4(_729)) + _484.xzxz;
        highp vec2 _786 = _484.zw / _86.xx;
        _528 = vec4(_786.x, _786.y, _528.z, _528.w);
        highp vec2 _791 = fract(_528.xy);
        _528 = vec4(_791.x, _528.y, _791.y, _528.w);
        _533 = _133.xxxx * _484.zwzw;
        _800 = greaterThanEqual(_533, -_533.zwzw);
        highp float _809;
        if (_800.x)
        {
            _809 = _133.x;
        }
        else
        {
            _809 = -_133.x;
        }
        _533.x = _809;
        highp float _822;
        if (_800.y)
        {
            _822 = _133.x;
        }
        else
        {
            _822 = -_133.x;
        }
        _533.y = _822;
        highp float _835;
        if (_800.z)
        {
            _835 = _133.x;
        }
        else
        {
            _835 = -_133.x;
        }
        _533.z = _835;
        highp float _848;
        if (_800.w)
        {
            _848 = _133.x;
        }
        else
        {
            _848 = -_133.x;
        }
        _533.w = _848;
        _561 = vec4(1.0) / _533.zwzw;
        _484 *= _561;
        _484 = fract(_484);
        _484 *= _533;
        _484 /= _133.xxxx;
        _875 = _86.x + _86.x;
        highp vec2 _888 = (_511.yx * vec2(_729)) + _511.xz;
        _511 = vec4(_888.x, _888.y, _511.z, _511.w);
        _891 = vec2(_875) * _511.xy;
        _897 = greaterThanEqual(_891.xyxy, -_891.xyxy).xy;
        highp float _907;
        if (_897.x)
        {
            _907 = _875;
        }
        else
        {
            _907 = -_875;
        }
        _891.x = _907;
        highp float _918;
        if (_897.y)
        {
            _918 = _875;
        }
        else
        {
            _918 = -_875;
        }
        _891.y = _918;
        highp vec2 _928 = vec2(1.0) / _891;
        _533 = vec4(_928.x, _928.y, _533.z, _533.w);
        highp vec2 _935 = _511.xy * _533.xy;
        _511 = vec4(_935.x, _935.y, _511.z, _511.w);
        highp vec2 _940 = fract(_511.xy);
        _511 = vec4(_940.x, _940.y, _511.z, _511.w);
        highp vec2 _946 = _511.xy * _891;
        _511 = vec4(_946.x, _946.y, _511.z, _511.w);
        highp vec2 _953 = _511.xy / vec2(_875);
        _511 = vec4(_953.x, _953.y, _511.z, _511.w);
        _956 = (-_511.y) + _511.x;
        _533.x = (-abs(_956)) + 1.0;
        _956 = fract(_511.x);
        _971 = _511.y + 0.5;
        _971 = fract(_971);
        _956 += _971;
        _956 = fract(_956);
        _971 = dot(vs_TEXCOORD0.zw, vec2(vec2(_A_RampUVOffset, _A_RampUVOffset)));
        highp vec3 _999 = (_345.xyz * vec3(0.5)) + vec3(0.5);
        _511 = vec4(_999.x, _999.y, _999.z, _511.w);
        _1002 = (_383.xyz * vec3(0.5)) + vec3(0.5);
        _1007 = dot(_511.xy, _1002.xy);
        _1007 += _A_CardTiltOffset;
        highp vec2 _1020 = _528.xz + vec2(1.0);
        _528 = vec4(_528.x, _1020.x, _528.z, _1020.y);
        _528 = (_528 * vec4(0.25)) + vec4(0.25);
        _528 = vec4(_1007) + (-_528);
        _528 = min(abs(_528), vec4(1.0));
        _1036 = _A_DiffractionPower * (-1.44269502162933349609375);
        _561 = _528 * _528;
        _528 = (_561 * vec4(0.5)) + _528;
        _528 = vec4(_1036) * _528;
        _528 = exp2(_528);
        _1056 = _528.yw + _528.xz;
        highp vec3 _1076 = _511.xyz * vec3(vec3(_A_RampSpeed, _A_RampSpeed, _A_RampSpeed));
        _528 = vec4(_1076.x, _1076.y, _1076.z, _528.w);
        _891.x = dot(_528.xyz, _1002);
        _484 = (-_484) + _891.xxxx;
        _484 = (_484 * vec4(_A_RampRepeat, _A_RampRepeat, _A_RampAlphaRepeat, _A_RampAlphaRepeat)) + vec4(vec4(_A_RampOffset, _A_RampOffset, _A_RampOffset, _A_RampOffset));
        highp vec2 _1134 = (vec2(vec2(_A_RampFadeLength, _A_RampFadeLength)) * vec2(2.0)) + vec2(_A_RampInterval);
        _561 = vec4(_1134.x, _1134.y, _561.z, _561.w);
        _566 = floor(_484);
        _484 += (-_566);
        highp vec2 _1145 = vec2(_A_RampInterval);
        _561 = vec4(_561.x, _561.y, _1145.x, _1145.y);
        _566 = _561.yyww + vec4(1.0);
        _561 *= vec4(0.5);
        _484 = (_484 * _566) + (-_561);
        _626 = _484;
        _626 = clamp(_626, vec4(0.0), vec4(1.0));
        _626 = vec4(_971) + _626;
        highp vec2 _1172 = _484.xy + vec2(-0.5);
        _484 = vec4(_1172.x, _1172.y, _484.z, _484.w);
        highp vec2 _1183 = (_566.yy * vec2(0.5)) + (-abs(_484.xy));
        _484 = vec4(_1183.x, _1183.y, _484.z, _484.w);
        _971 = 1.0 / _A_RampFadeLength;
        highp vec2 _1193 = vec2(_971) * _484.xy;
        _484 = vec4(_1193.x, _1193.y, _484.z, _484.w);
        highp vec2 _1200 = clamp(_484.xy, vec2(0.0), vec2(1.0));
        _484 = vec4(_1200.x, _1200.y, _484.z, _484.w);
        _1203 = (_484.xy * vec2(-2.0)) + vec2(3.0);
        highp vec2 _1216 = _484.xy * _484.xy;
        _484 = vec4(_1216.x, _1216.y, _484.z, _484.w);
        _1219 = vec4(_626.zx.x, _1219.y, _626.zx.y, _1219.w);
        _1219.y = 0.5;
        _1219.w = 0.5;
        _1226 = texture(_1227, pcrStoredUv( _1219.xy)).w;
        _1233 = texture(_1227, pcrStoredUv( _1219.zw)).xyz;
        _1219 = vec4(_626.yw.x, _1219.y, _626.yw.y, _1219.w);
        _1219.y = 0.5;
        _1219.w = 0.5;
        _1245 = texture(_1227, pcrStoredUv( _1219.xy)).xyz;
        _1251 = texture(_1227, pcrStoredUv( _1219.zw)).w;
        _1257 = float(_A_UseRampFade);
        highp vec2 _1266 = (_1203 * _484.xy) + vec2(-1.0);
        _484 = vec4(_1266.x, _1266.y, _484.z, _484.w);
        highp vec2 _1274 = (vec2(_1257) * _484.xy) + vec2(1.0);
        _484 = vec4(_1274.x, _1274.y, _484.z, _484.w);
        _484.x *= _1226;
        _484.y *= _1251;
        highp vec2 _1292 = _484.yx * _1056.yx;
        _1287 = vec3(_1292.x, _1292.y, _1287.z);
        _484.x = (_1056.x * _484.x) + _1287.x;
        _1304 = _484.x;
        _1304 = clamp(_1304, 0.0, 1.0);
        _1203.x = max(_1287.x, _1287.y);
        _1203.x = (-_1304) + _1203.x;
        _1219.w = (_A_HoloCrossPower * _1203.x) + _1304;
        _484.x += 9.9999997473787516355514526367188e-06;
        _484.x = _1287.x / _484.x;
        _1287 = (-_1233) + _1245;
        highp vec3 _1350 = (_484.xxx * _1287) + _1233;
        _484 = vec4(_1350.x, _1350.y, _1350.z, _484.w);
        highp vec3 _1367 = _484.xyz * vec3(vec3(_A_DiffractionIntensity, _A_DiffractionIntensity, _A_DiffractionIntensity));
        _1219 = vec4(_1367.x, _1367.y, _1367.z, _1219.w);
        _533.y = (-_533.x) + 2.0;
        highp vec2 _1381 = (_533.xy * vec2(0.25)) + vec2(0.23999999463558197021484375);
        _484 = vec4(_1381.x, _1381.y, _484.z, _484.w);
        _1203.x = _1007 + (-0.5);
        _1304 = (_1203.x * 0.800000011920928955078125) + 0.5;
        _1007 = (-_956) + 1.0;
        _1395.x = (_1203.x * (-2.0)) + (-_1007);
        _1395.y = (_1203.x * 2.0) + (-_956);
        highp vec2 _1414 = min(abs(_1395.xy), vec2(1.0));
        _1410 = vec3(_1414.x, _1410.y, _1414.y);
        _1417 = vec2(_A_InnerBlockDiffractionWidthPower, _A_InnerBlockDiffractionPower) * vec2(-1.44269502162933349609375);
        highp vec2 _1431 = _1410.xz * _1410.xz;
        _1395 = vec4(_1431.x, _1431.y, _1395.z, _1395.w);
        highp vec2 _1439 = (_1395.xy * vec2(0.5)) + _1410.xz;
        _1410 = vec3(_1439.x, _1410.y, _1439.y);
        highp vec2 _1446 = _1410.xz * _1417.xx;
        _1410 = vec3(_1446.x, _1410.y, _1446.y);
        highp vec2 _1451 = exp2(_1410.xz);
        _1410 = vec3(_1451.x, _1410.y, _1451.y);
        highp vec2 _1459 = (-_484.xy) + vec2(_1304);
        _484 = vec4(_1459.x, _1459.y, _484.z, _484.w);
        highp vec2 _1465 = min(abs(_484.xy), vec2(1.0));
        _484 = vec4(_1465.x, _1465.y, _484.z, _484.w);
        _1203 = _484.xy * _484.xy;
        highp vec2 _1477 = (_1203 * vec2(0.5)) + _484.xy;
        _484 = vec4(_1477.x, _1477.y, _484.z, _484.w);
        highp vec2 _1484 = _484.xy * _1417.yy;
        _484 = vec4(_1484.x, _1484.y, _484.z, _484.w);
        highp vec2 _1489 = exp2(_484.xy);
        _484 = vec4(_1489.x, _1489.y, _484.z, _484.w);
        highp vec2 _1496 = _1410.xz * _484.xy;
        _484 = vec4(_1496.x, _1496.y, _484.z, _484.w);
        _1056.x = max(_484.y, _484.x);
        _956 = min(_1056.x, 1.0);
        _484.x = ((-_533.x) * _533.x) + 1.0;
        _484.x = (_484.x * _A_InnerBlockRampOffsetScale) + _626.x;
        _484.y = 0.5;
        _1203.y = 0.5;
        vec3 _1533 = texture(_1227, pcrStoredUv( _484.xy)).xyz;
        _1528 = vec4(_1533.x, _1533.y, _1528.z, _1533.z);
        _484.x = _1226 + (-1.0);
        _484.x = (_A_InnerBlockUseRampAlpha * _484.x) + 1.0;
        _956 *= _484.x;
        _956 = clamp(_956, 0.0, 1.0);
        vec3 _1560 = _1528.xyw * vec3(_A_InnerBlockDiffractionIntensity);
        _1553 = vec4(_1560.x, _1560.y, _1560.z, _1553.w);
        _1553.w = _956 * _A_InnerBlockDiffractionIntensity;
        _956 = (_956 * _A_InnerBlockDiffractionIntensity) + _1219.w;
        _956 += 9.9999997473787516355514526367188e-06;
        _956 = _1553.w / _956;
        _1553 = (-_1219) + _1553;
        _1219 = (vec4(_956) * _1553) + _1219;
        highp vec3 _1596 = _A_Multi1LightDir * vec3(0.01745329238474369049072265625);
        _533 = vec4(_1596.x, _1596.y, _533.z, _1596.z);
        _484.x = sin(_533.x);
        _1395.x = cos(_533.x);
        _1395.y = -_484.x;
        _1611.y = dot(_1395.xy, _383.yz);
        _1395.z = _484.x;
        _383.w = dot(_1395.zx, _383.yz);
        _484.x = sin(_533.y);
        _533.x = cos(_533.y);
        _484.y = _533.x;
        _1611.x = dot(_484.yx, _383.xw);
        _484.x = -_484.x;
        _1395.z = dot(_484.xy, _383.xw);
        _484.x = sin(_533.w);
        _1658.x = cos(_533.w);
        _1658.y = -_484.x;
        _1395.x = dot(_1658.xy, _1611.xy);
        _1658.z = _484.x;
        _1395.y = dot(_1658.zx, _1611.xy);
        highp vec2 _1685 = (-vs_TEXCOORD0.zw) + vec2(1.0);
        _484 = vec4(_1685.x, _1685.y, _484.z, _484.w);
        highp vec3 _1691 = (vs_TEXCOORD3.zww * vec3(1.0, 1.0, -1.0)) + vec3(0.0, 0.0, 1.0);
        _533 = vec4(_1691.x, _1691.y, _533.z, _1691.z);
        highp vec3 _1698 = vec3(_729) * _533.xyw;
        _533 = vec4(_1698.x, _1698.y, _533.z, _1698.z);
        highp vec3 _1703 = floor(_533.xyw);
        _533 = vec4(_1703.x, _1703.y, _533.z, _1703.z);
        _1611.x = float(_A_Multi1StripePosOffsetX);
        highp vec2 _1718 = vec2(vec2(float(_A_Multi1StripePosOffsetY)));
        _1611 = vec4(_1611.x, _1718.x, _1718.y, _1611.w);
        highp vec3 _1725 = _533.xyw + _1611.xyz;
        _533 = vec4(_1725.x, _1725.y, _533.z, _1725.z);
        highp vec3 _1732 = _498.xyz + _533.xyw;
        _498 = vec4(_1732.x, _1732.y, _1732.z, _498.w);
        _1553 = (_533.yxyx * vec4(_729)) + _533.xwxw;
        highp vec2 _1747 = _1553.zw / _86.xx;
        _533 = vec4(_1747.x, _1747.y, _533.z, _533.w);
        highp vec2 _1752 = fract(_533.xy);
        _1611 = vec4(_1752.x, _1611.y, _1752.y, _1611.w);
        _1658 = _133.xxxx * _1553.zwzw;
        _1760 = greaterThanEqual(_1658, -_1658.zwzw);
        highp float _1768;
        if (_1760.x)
        {
            _1768 = _133.x;
        }
        else
        {
            _1768 = -_133.x;
        }
        _1658.x = _1768;
        highp float _1781;
        if (_1760.y)
        {
            _1781 = _133.x;
        }
        else
        {
            _1781 = -_133.x;
        }
        _1658.y = _1781;
        highp float _1794;
        if (_1760.z)
        {
            _1794 = _133.x;
        }
        else
        {
            _1794 = -_133.x;
        }
        _1658.z = _1794;
        highp float _1807;
        if (_1760.w)
        {
            _1807 = _133.x;
        }
        else
        {
            _1807 = -_133.x;
        }
        _1658.w = _1807;
        _1818 = vec4(1.0) / _1658.zwzw;
        _1553 *= _1818;
        _1553 = fract(_1553);
        _1553 *= _1658;
        _1553 /= _133.xxxx;
        _86 = (_498.yx * vec2(_729)) + _498.xz;
        highp vec2 _1845 = vec2(_875) * _86;
        _498 = vec4(_1845.x, _1845.y, _498.z, _498.w);
        _1848 = greaterThanEqual(_498.xyxx, -_498.xyxx).xy;
        highp float _1858;
        if (_1848.x)
        {
            _1858 = _875;
        }
        else
        {
            _1858 = -_875;
        }
        _498.x = _1858;
        highp float _1869;
        if (_1848.y)
        {
            _1869 = _875;
        }
        else
        {
            _1869 = -_875;
        }
        _498.y = _1869;
        _1878 = vec2(1.0) / _498.xy;
        _86 *= _1878;
        _86 = fract(_86);
        _86 *= _498.xy;
        _86 /= vec2(_875);
        _133.x = (-_86.y) + _86.x;
        _498.x = (-abs(_133.x)) + 1.0;
        _133.x = fract(_86.x);
        _86.x = _86.y + 0.5;
        _86.x = fract(_86.x);
        _133.x += _86.x;
        _133.x = fract(_133.x);
        _86 = _484.xy * vec2(vec2(_A_RampUVOffset, _A_RampUVOffset));
        _86.x = _86.y + _86.x;
        _1947 = (_1395.xyz * vec3(0.5)) + vec3(0.5);
        _729 = dot(_511.xy, _1947.xy);
        _1957.y = _729 + _A_CardTiltOffset;
        highp vec2 _1965 = _1611.xz + vec2(1.0);
        _1611 = vec4(_1611.x, _1965.x, _1611.z, _1965.y);
        _1395 = (_1611 * vec4(0.25)) + vec4(0.25);
        _1395 = _1957.yyyy + (-_1395);
        _1395 = min(abs(_1395), vec4(1.0));
        _1611 = _1395 * _1395;
        _1395 = (_1611 * vec4(0.5)) + _1395;
        _511 = vec4(_1036) * _1395;
        _511 = exp2(_511);
        _1992 = _511.yw + _511.xz;
        _875 = dot(_528.xyz, _1947);
        _511 = (-_1553) + vec4(_875);
        _511 = (_511 * vec4(_A_RampRepeat, _A_RampRepeat, _A_RampAlphaRepeat, _A_RampAlphaRepeat)) + vec4(vec4(_A_RampOffset, _A_RampOffset, _A_RampOffset, _A_RampOffset));
        _528 = floor(_511);
        _511 += (-_528);
        _511 = (_511 * _566) + (-_561);
        _528 = _511;
        _528 = clamp(_528, vec4(0.0), vec4(1.0));
        _528 = _86.xxxx + _528.wxyz;
        highp vec2 _2057 = _511.xy + vec2(-0.5);
        _484 = vec4(_2057.x, _2057.y, _484.z, _484.w);
        highp vec2 _2067 = (_566.yy * vec2(0.5)) + (-abs(_484.xy));
        _484 = vec4(_2067.x, _2067.y, _484.z, _484.w);
        highp vec2 _2074 = vec2(_971) * _484.xy;
        _484 = vec4(_2074.x, _2074.y, _484.z, _484.w);
        highp vec2 _2081 = clamp(_484.xy, vec2(0.0), vec2(1.0));
        _484 = vec4(_2081.x, _2081.y, _484.z, _484.w);
        _1878 = (_484.xy * vec2(-2.0)) + vec2(3.0);
        highp vec2 _2092 = _484.xy * _484.xy;
        _484 = vec4(_2092.x, _2092.y, _484.z, _484.w);
        _1203.x = _528.w;
        _1957.x = texture(_1227, pcrStoredUv( _1203)).w;
        _511 = vec4(_528.yz.x, _511.y, _528.yz.y, _511.w);
        _511.y = 0.5;
        _511.w = 0.5;
        vec3 _2113 = texture(_1227, pcrStoredUv( _511.xy)).xyz;
        _1528 = vec4(_2113.x, _2113.y, _1528.z, _2113.z);
        _2116 = texture(_1227, pcrStoredUv( _511.zw)).xyz;
        _528.y = 0.5;
        _2123.y = 0.5;
        _2125 = texture(_1227, pcrStoredUv( _528.xy)).w;
        highp vec2 _2135 = (_1878 * _484.xy) + vec2(-1.0);
        _484 = vec4(_2135.x, _2135.y, _484.z, _484.w);
        highp vec2 _2143 = (vec2(_1257) * _484.xy) + vec2(1.0);
        _484 = vec4(_2143.x, _2143.y, _484.z, _484.w);
        _956 = _1957.x * _484.x;
        _875 = _2125 * _484.y;
        _971 = _956 * _1992.x;
        _875 *= _1992.y;
        _956 = (_1992.x * _956) + _875;
        _2169 = _956;
        _2169 = clamp(_2169, 0.0, 1.0);
        _971 = max(_875, _971);
        _971 = (-_2169) + _971;
        _484.w = (_A_HoloCrossPower * _971) + _2169;
        _956 += 9.9999997473787516355514526367188e-06;
        _875 /= _956;
        _2192 = (-_1528.xyw) + _2116;
        _2192 = (vec3(_875) * _2192) + _1528.xyw;
        highp vec3 _2217 = _2192 * vec3(vec3(_A_DiffractionIntensity, _A_DiffractionIntensity, _A_DiffractionIntensity));
        _484 = vec4(_2217.x, _2217.y, _2217.z, _484.w);
        _498.y = (-_498.x) + 2.0;
        highp vec2 _2229 = (_498.xy * vec2(0.25)) + vec2(0.23999999463558197021484375);
        _2225 = vec3(_2229.x, _2229.y, _2225.z);
        _86 = _1957 + vec2(-1.0, -0.5);
        _875 = (_86.y * 0.800000011920928955078125) + 0.5;
        _956 = (-_133.x) + 1.0;
        _528.x = (_86.y * (-2.0)) + (-_956);
        _528.y = (_86.y * 2.0) + (-_133.x);
        highp vec2 _2261 = min(abs(_528.xy), vec2(1.0));
        _2192 = vec3(_2261.x, _2261.y, _2192.z);
        highp vec2 _2268 = _2192.xy * _2192.xy;
        _528 = vec4(_2268.x, _2268.y, _528.z, _528.w);
        highp vec2 _2276 = (_528.xy * vec2(0.5)) + _2192.xy;
        _2192 = vec3(_2276.x, _2276.y, _2192.z);
        highp vec2 _2283 = _2192.xy * _1417.xx;
        _2192 = vec3(_2283.x, _2283.y, _2192.z);
        highp vec2 _2288 = exp2(_2192.xy);
        _2192 = vec3(_2288.x, _2288.y, _2192.z);
        highp vec2 _2296 = (-_2225.xy) + vec2(_875);
        _2225 = vec3(_2296.x, _2296.y, _2225.z);
        highp vec2 _2302 = min(abs(_2225.xy), vec2(1.0));
        _2225 = vec3(_2302.x, _2302.y, _2225.z);
        highp vec2 _2309 = _2225.xy * _2225.xy;
        _528 = vec4(_2309.x, _2309.y, _528.z, _528.w);
        highp vec2 _2317 = (_528.xy * vec2(0.5)) + _2225.xy;
        _2225 = vec3(_2317.x, _2317.y, _2225.z);
        highp vec2 _2324 = _2225.xy * _1417.yy;
        _2225 = vec3(_2324.x, _2324.y, _2225.z);
        highp vec2 _2329 = exp2(_2225.xy);
        _2225 = vec3(_2329.x, _2329.y, _2225.z);
        highp vec2 _2336 = _2192.xy * _2225.xy;
        _2225 = vec3(_2336.x, _2336.y, _2225.z);
        _1947.x = max(_2225.y, _2225.x);
        _133.x = min(_1947.x, 1.0);
        _729 = ((-_498.x) * _498.x) + 1.0;
        _2123.x = (_729 * _A_InnerBlockRampOffsetScale) + _511.x;
        _2364 = texture(_1227, pcrStoredUv( _2123)).xyz;
        _86.x = (_A_InnerBlockUseRampAlpha * _86.x) + 1.0;
        _133.x *= _86.x;
        _133.x = clamp(_133.x, 0.0, 1.0);
        vec3 _2390 = _2364 * vec3(_A_InnerBlockDiffractionIntensity);
        _498 = vec4(_2390.x, _2390.y, _2390.z, _498.w);
        _498.w = _133.x * _A_InnerBlockDiffractionIntensity;
        _133.x = (_133.x * _A_InnerBlockDiffractionIntensity) + _484.w;
        _133.x += 9.9999997473787516355514526367188e-06;
        _133.x = _498.w / _133.x;
        _498 = (-_484) + _498;
        _484 = (_133.xxxx * _498) + _484;
        _133.x = _484.w * _A_Multi1DiffractionIntensityRatio;
        _1947.x = _133.x * _133.x;
        _2441.x = (_1219.w * _1219.w) + _1947.x;
        _2441.x += 9.9999997473787516355514526367188e-05;
        _1947.x /= _2441.x;
        _2441 = (_484.xyz * vec3(vec3(_A_Multi1DiffractionIntensityRatio, _A_Multi1DiffractionIntensityRatio, _A_Multi1DiffractionIntensityRatio))) + (-_1219.xyz);
        _2480 = (_1947.xxx * _2441) + _1219.xyz;
        _1947.x = max(_133.x, _1219.w);
        _133.x = _A_FrontMaskRangeUVY + (-_A_FrontMaskRangeSmooth);
        _86.x = _A_FrontMaskRangeUVY + _A_FrontMaskRangeSmooth;
        _86.x = (-_133.x) + _86.x;
        _133.x = (-_133.x) + vs_TEXCOORD0.y;
        _86.x = 1.0 / _86.x;
        _133.x *= _86.x;
        _133.x = clamp(_133.x, 0.0, 1.0);
        _86.x = (_133.x * (-2.0)) + 3.0;
        _133.x *= _133.x;
        _133.x *= _86.x;
        _86.x = (-_A_HologramFrontMask) + _A_HologramFrontMaskOnAll;
        _133.x = (_133.x * _86.x) + _A_HologramFrontMask;
        _86.x = dot(_345.xyz, -_383.xyz);
        _86.x = log2(_86.x);
        _86.x *= _A_MaskPower;
        _86.x = exp2(_86.x);
        _133.x += (-_86.x);
        _133.x += 1.0;
        _133.x = clamp(_133.x, 0.0, 1.0);
        _9.x *= _133.x;
        _9.x = _43.x * _9.x;
        _484.w = _9.x * _1947.x;
        _484 = vec4(_2480.x, _2480.y, _2480.z, _484.w);
    }
    else
    {
        _484.x = 0.0;
        _484.y = 0.0;
        _484.z = 0.0;
        _484.w = 0.0;
    }
    if (_691.y)
    {
        _2640.x = int(_B_RampLoopLength);
        _2640.z = (_B_StripeLoopLength * _B_OneStripeBlockCount) + _B_ZureBlockCount;
        _2640.x *= _B_OneStripeBlockCount;
        highp vec2 _2667 = vec2(_2640.xz);
        _9 = vec4(_2667.x, _9.y, _2667.y, _9.w);
        _33 = float(_B_OneStripeBlockCount);
        highp vec3 _2677 = (vs_TEXCOORD4.xyy * vec3(1.0, 1.0, -1.0)) + vec3(0.0, 0.0, 1.0);
        _498 = vec4(_2677.x, _2677.y, _2677.z, _498.w);
        highp vec3 _2684 = vec3(_33) * _498.xyz;
        _498 = vec4(_2684.x, _2684.y, _2684.z, _498.w);
        highp vec3 _2689 = floor(_498.xyz);
        _498 = vec4(_2689.x, _2689.y, _2689.z, _498.w);
        highp vec3 _2699 = vec3(ivec3(_A_InnerBlockPosOffsetX, _A_InnerBlockPosOffsetY, _A_InnerBlockPosOffsetY));
        _511 = vec4(_2699.x, _2699.y, _2699.z, _511.w);
        highp vec3 _2706 = _498.xyz + _511.xyz;
        _528 = vec4(_2706.x, _2706.y, _2706.z, _528.w);
        _498 = (_498.yxyx * vec4(_33)) + _498.xzxz;
        _86 = _498.zw / _9.zz;
        highp vec2 _2723 = fract(_86);
        _533 = vec4(_2723.x, _533.y, _2723.y, _533.w);
        _561 = _9.xxxx * _498.zwzw;
        _2731 = greaterThanEqual(_561, -_561.zwzw);
        highp float _2739;
        if (_2731.x)
        {
            _2739 = _9.x;
        }
        else
        {
            _2739 = -_9.x;
        }
        _561.x = _2739;
        highp float _2752;
        if (_2731.y)
        {
            _2752 = _9.x;
        }
        else
        {
            _2752 = -_9.x;
        }
        _561.y = _2752;
        highp float _2765;
        if (_2731.z)
        {
            _2765 = _9.x;
        }
        else
        {
            _2765 = -_9.x;
        }
        _561.z = _2765;
        highp float _2778;
        if (_2731.w)
        {
            _2778 = _9.x;
        }
        else
        {
            _2778 = -_9.x;
        }
        _561.w = _2778;
        _566 = vec4(1.0) / _561.zwzw;
        _498 *= _566;
        _498 = fract(_498);
        _498 *= _561;
        _498 /= _9.xxxx;
        _86.x = _9.z + _9.z;
        highp vec2 _2817 = (_528.yx * vec2(_33)) + _528.xz;
        _528 = vec4(_2817.x, _2817.y, _528.z, _528.w);
        _2123 = _86.xx * _528.xy;
        _2825 = greaterThanEqual(_2123.xyxy, -_2123.xyxy).xy;
        highp float _2835;
        if (_2825.x)
        {
            _2835 = _86.x;
        }
        else
        {
            _2835 = -_86.x;
        }
        _2123.x = _2835;
        highp float _2848;
        if (_2825.y)
        {
            _2848 = _86.x;
        }
        else
        {
            _2848 = -_86.x;
        }
        _2123.y = _2848;
        highp vec2 _2860 = vec2(1.0) / _2123;
        _561 = vec4(_2860.x, _2860.y, _561.z, _561.w);
        highp vec2 _2867 = _528.xy * _561.xy;
        _528 = vec4(_2867.x, _2867.y, _528.z, _528.w);
        highp vec2 _2872 = fract(_528.xy);
        _528 = vec4(_2872.x, _2872.y, _528.z, _528.w);
        highp vec2 _2878 = _528.xy * _2123;
        _528 = vec4(_2878.x, _2878.y, _528.z, _528.w);
        highp vec2 _2885 = _528.xy / _86.xx;
        _528 = vec4(_2885.x, _2885.y, _528.z, _528.w);
        _729 = (-_528.y) + _528.x;
        _561.x = (-abs(_729)) + 1.0;
        _729 = fract(_528.x);
        _875 = _528.y + 0.5;
        _875 = fract(_875);
        _729 += _875;
        _729 = fract(_729);
        _875 = dot(vs_TEXCOORD0.zw, vec2(vec2(_B_RampUVOffset, _B_RampUVOffset)));
        highp vec3 _2927 = (_345.xyz * vec3(0.5)) + vec3(0.5);
        _528 = vec4(_2927.x, _2927.y, _2927.z, _528.w);
        _1947 = (_383.xyz * vec3(0.5)) + vec3(0.5);
        _956 = dot(_528.xy, _1947.xy);
        _956 += _B_CardTiltOffset;
        highp vec2 _2946 = _533.xz + vec2(1.0);
        _533 = vec4(_533.x, _2946.x, _533.z, _2946.y);
        _533 = (_533 * vec4(0.25)) + vec4(0.25);
        _533 = vec4(_956) + (-_533);
        _533 = min(abs(_533), vec4(1.0));
        _971 = _B_DiffractionPower * (-1.44269502162933349609375);
        _566 = _533 * _533;
        _533 = (_566 * vec4(0.5)) + _533;
        _533 = vec4(_971) * _533;
        _533 = exp2(_533);
        _1992 = _533.yw + _533.xz;
        highp vec3 _2996 = _528.xyz * vec3(vec3(_B_RampSpeed, _B_RampSpeed, _B_RampSpeed));
        _533 = vec4(_2996.x, _2996.y, _2996.z, _533.w);
        _2169 = dot(_533.xyz, _1947);
        _498 = (-_498) + vec4(_2169);
        _498 = (_498 * vec4(_B_RampRepeat, _B_RampRepeat, _B_RampAlphaRepeat, _B_RampAlphaRepeat)) + vec4(vec4(_B_RampOffset, _B_RampOffset, _B_RampOffset, _B_RampOffset));
        highp vec2 _3050 = (vec2(vec2(_A_RampFadeLength, _A_RampFadeLength)) * vec2(2.0)) + vec2(_B_RampInterval);
        _566 = vec4(_3050.x, _3050.y, _566.z, _566.w);
        _626 = floor(_498);
        _498 += (-_626);
        highp vec2 _3061 = vec2(_B_RampInterval);
        _566 = vec4(_566.x, _566.y, _3061.x, _3061.y);
        _626 = _566.yyww + vec4(1.0);
        _566 *= vec4(0.5);
        _498 = (_498 * _626) + (-_566);
        _1219 = _498;
        _1219 = clamp(_1219, vec4(0.0), vec4(1.0));
        _1219 = vec4(_875) + _1219;
        highp vec2 _3086 = _498.xy + vec2(-0.5);
        _498 = vec4(_3086.x, _3086.y, _498.z, _498.w);
        highp vec2 _3096 = (_626.yy * vec2(0.5)) + (-abs(_498.xy));
        _498 = vec4(_3096.x, _3096.y, _498.z, _498.w);
        _875 = 1.0 / _A_RampFadeLength;
        highp vec2 _3106 = vec2(_875) * _498.xy;
        _498 = vec4(_3106.x, _3106.y, _498.z, _498.w);
        highp vec2 _3113 = clamp(_498.xy, vec2(0.0), vec2(1.0));
        _498 = vec4(_3113.x, _3113.y, _498.z, _498.w);
        _1878 = (_498.xy * vec2(-2.0)) + vec2(3.0);
        highp vec2 _3124 = _498.xy * _498.xy;
        _498 = vec4(_3124.x, _3124.y, _498.z, _498.w);
        _1553 = vec4(_1219.zx.x, _1553.y, _1219.zx.y, _1553.w);
        _1553.y = 0.5;
        _1553.w = 0.5;
        _3133 = texture(_3134, pcrStoredUv( _1553.xy)).w;
        _1233 = texture(_3134, pcrStoredUv( _1553.zw)).xyz;
        _1553 = vec4(_1219.yw.x, _1553.y, _1219.yw.y, _1553.w);
        _1553.y = 0.5;
        _1553.w = 0.5;
        _3151 = texture(_3134, pcrStoredUv( _1553.xy)).xyz;
        _3157 = texture(_3134, pcrStoredUv( _1553.zw)).w;
        _2123.x = float(_A_UseRampFade);
        highp vec2 _3171 = (_1878 * _498.xy) + vec2(-1.0);
        _498 = vec4(_3171.x, _3171.y, _498.z, _498.w);
        highp vec2 _3179 = (_2123.xx * _498.xy) + vec2(1.0);
        _498 = vec4(_3179.x, _3179.y, _498.z, _498.w);
        _498.x = _3133 * _498.x;
        _498.y *= _3157;
        highp vec2 _3196 = _498.yx * _1992.yx;
        _2225 = vec3(_3196.x, _3196.y, _2225.z);
        _498.x = (_1992.x * _498.x) + _2225.x;
        _1007 = _498.x;
        _1007 = clamp(_1007, 0.0, 1.0);
        _1878.x = max(_2225.x, _2225.y);
        _1878.x = (-_1007) + _1878.x;
        _1553.w = (_B_HoloCrossPower * _1878.x) + _1007;
        _498.x += 9.9999997473787516355514526367188e-06;
        _498.x = _2225.x / _498.x;
        _2225 = (-_1233) + _3151;
        highp vec3 _3252 = (_498.xxx * _2225) + _1233;
        _498 = vec4(_3252.x, _3252.y, _3252.z, _498.w);
        highp vec3 _3269 = _498.xyz * vec3(vec3(_B_DiffractionIntensity, _B_DiffractionIntensity, _B_DiffractionIntensity));
        _1553 = vec4(_3269.x, _3269.y, _3269.z, _1553.w);
        _561.y = (-_561.x) + 2.0;
        highp vec2 _3280 = (_561.xy * vec2(0.25)) + vec2(0.23999999463558197021484375);
        _498 = vec4(_3280.x, _3280.y, _498.z, _498.w);
        _956 += (-0.5);
        _1878.x = (_956 * 0.800000011920928955078125) + 0.5;
        _1007 = (-_729) + 1.0;
        _1395.x = (_956 * (-2.0)) + (-_1007);
        _1395.y = (_956 * 2.0) + (-_729);
        _3304 = min(abs(_1395.xy), vec2(1.0));
        _729 = _B_InnerBlockDiffractionWidthPower * (-1.44269502162933349609375);
        highp vec2 _3315 = _3304 * _3304;
        _1395 = vec4(_3315.x, _3315.y, _1395.z, _1395.w);
        _3304 = (_1395.xy * vec2(0.5)) + _3304;
        _3304 = vec2(_729) * _3304;
        _3304 = exp2(_3304);
        highp vec2 _3334 = (-_498.xy) + _1878.xx;
        _498 = vec4(_3334.x, _3334.y, _498.z, _498.w);
        highp vec2 _3340 = min(abs(_498.xy), vec2(1.0));
        _498 = vec4(_3340.x, _3340.y, _498.z, _498.w);
        _956 = _B_InnerBlockDiffractionPower * (-1.44269502162933349609375);
        _1878 = _498.xy * _498.xy;
        highp vec2 _3356 = (_1878 * vec2(0.5)) + _498.xy;
        _498 = vec4(_3356.x, _3356.y, _498.z, _498.w);
        highp vec2 _3363 = vec2(_956) * _498.xy;
        _498 = vec4(_3363.x, _3363.y, _498.z, _498.w);
        highp vec2 _3368 = exp2(_498.xy);
        _498 = vec4(_3368.x, _3368.y, _498.z, _498.w);
        highp vec2 _3374 = _3304 * _498.xy;
        _498 = vec4(_3374.x, _3374.y, _498.z, _498.w);
        _1947.x = max(_498.y, _498.x);
        _498.x = min(_1947.x, 1.0);
        _2225.x = ((-_561.x) * _561.x) + 1.0;
        _561.x = (_2225.x * _B_InnerBlockRampOffsetScale) + _1219.x;
        _561.y = 0.5;
        _3406.y = 0.5;
        _3408 = texture(_3134, pcrStoredUv( _561.xy)).xyz;
        _2169 = _3133 + (-1.0);
        _2169 = (_A_InnerBlockUseRampAlpha * _2169) + 1.0;
        _2169 *= _498.x;
        _2169 = clamp(_2169, 0.0, 1.0);
        vec3 _3440 = _3408 * vec3(vec3(_B_InnerBlockDiffractionIntensity, _B_InnerBlockDiffractionIntensity, _B_InnerBlockDiffractionIntensity));
        _498 = vec4(_3440.x, _3440.y, _3440.z, _498.w);
        _498.w = _2169 * _B_InnerBlockDiffractionIntensity;
        _2169 = (_2169 * _B_InnerBlockDiffractionIntensity) + _1553.w;
        _2169 += 9.9999997473787516355514526367188e-06;
        _2169 = _498.w / _2169;
        _498 = (-_1553) + _498;
        _498 = (vec4(_2169) * _498) + _1553;
        highp vec3 _3474 = _B_Multi1LightDir * vec3(0.01745329238474369049072265625);
        _1395 = vec4(_3474.x, _3474.y, _3474.z, _1395.w);
        _561.x = sin(_1395.x);
        _1611.x = cos(_1395.x);
        _1611.y = -_561.x;
        _1658.y = dot(_1611.xy, _383.yz);
        _1611.z = _561.x;
        _561.y = dot(_1611.zx, _383.yz);
        _1611.x = cos(_1395.y);
        _1395.x = sin(_1395.y);
        _1395.y = _1611.x;
        _561.x = _383.x;
        _1658.x = dot(_1395.yx, _561.xy);
        _1395.x = -_1395.x;
        _1611.z = dot(_1395.xy, _561.xy);
        _561.x = sin(_1395.z);
        _1395.x = cos(_1395.z);
        _1395.y = -_561.x;
        _1611.x = dot(_1395.xy, _1658.xy);
        _1395.z = _561.x;
        _1611.y = dot(_1395.zx, _1658.xy);
        highp vec2 _3564 = (-vs_TEXCOORD0.zw) + vec2(1.0);
        _561 = vec4(_3564.x, _3564.y, _561.z, _561.w);
        highp vec3 _3570 = (vs_TEXCOORD4.zww * vec3(1.0, 1.0, -1.0)) + vec3(0.0, 0.0, 1.0);
        _1395 = vec4(_3570.x, _3570.y, _3570.z, _1395.w);
        highp vec3 _3577 = vec3(_33) * _1395.xyz;
        _1395 = vec4(_3577.x, _3577.y, _3577.z, _1395.w);
        highp vec3 _3582 = floor(_1395.xyz);
        _1395 = vec4(_3582.x, _3582.y, _3582.z, _1395.w);
        _1658.x = float(_B_Multi1StripePosOffsetX);
        highp vec2 _3597 = vec2(vec2(float(_B_Multi1StripePosOffsetY)));
        _1658 = vec4(_1658.x, _3597.x, _3597.y, _1658.w);
        highp vec3 _3604 = _1395.xyz + _1658.xyz;
        _1395 = vec4(_3604.x, _3604.y, _3604.z, _1395.w);
        highp vec3 _3611 = _511.xyz + _1395.xyz;
        _511 = vec4(_3611.x, _3611.y, _3611.z, _511.w);
        _1219 = (_1395.yxyx * vec4(_33)) + _1395.xzxz;
        highp vec2 _3626 = _1219.zw / _9.zz;
        _1395 = vec4(_3626.x, _3626.y, _1395.z, _1395.w);
        highp vec2 _3631 = fract(_1395.xy);
        _1553 = vec4(_3631.x, _1553.y, _3631.y, _1553.w);
        _1395 = _9.xxxx * _1219.zwzw;
        _3639 = greaterThanEqual(_1395, -_1395.zwzw);
        highp float _3647;
        if (_3639.x)
        {
            _3647 = _9.x;
        }
        else
        {
            _3647 = -_9.x;
        }
        _1395.x = _3647;
        highp float _3660;
        if (_3639.y)
        {
            _3660 = _9.x;
        }
        else
        {
            _3660 = -_9.x;
        }
        _1395.y = _3660;
        highp float _3673;
        if (_3639.z)
        {
            _3673 = _9.x;
        }
        else
        {
            _3673 = -_9.x;
        }
        _1395.z = _3673;
        highp float _3686;
        if (_3639.w)
        {
            _3686 = _9.x;
        }
        else
        {
            _3686 = -_9.x;
        }
        _1395.w = _3686;
        _1658 = vec4(1.0) / _1395.zwzw;
        _1219 *= _1658;
        _1219 = fract(_1219);
        _1219 *= _1395;
        _1219 /= _9.xxxx;
        highp vec2 _3719 = (_511.yx * vec2(_33)) + _511.xz;
        _9 = vec4(_3719.x, _9.y, _3719.y, _9.w);
        highp vec2 _3726 = _86.xx * _9.xz;
        _511 = vec4(_3726.x, _3726.y, _511.z, _511.w);
        _3729 = greaterThanEqual(_511.xyxx, -_511.xyxx).xy;
        highp float _3739;
        if (_3729.x)
        {
            _3739 = _86.x;
        }
        else
        {
            _3739 = -_86.x;
        }
        _511.x = _3739;
        highp float _3752;
        if (_3729.y)
        {
            _3752 = _86.x;
        }
        else
        {
            _3752 = -_86.x;
        }
        _511.y = _3752;
        _891 = vec2(1.0) / _511.xy;
        highp vec2 _3769 = _9.xz * _891;
        _9 = vec4(_3769.x, _9.y, _3769.y, _9.w);
        highp vec2 _3774 = fract(_9.xz);
        _9 = vec4(_3774.x, _9.y, _3774.y, _9.w);
        highp vec2 _3781 = _9.xz * _511.xy;
        _9 = vec4(_3781.x, _9.y, _3781.y, _9.w);
        highp vec2 _3788 = _9.xz / _86.xx;
        _9 = vec4(_3788.x, _9.y, _3788.y, _9.w);
        _33 = (-_9.z) + _9.x;
        _511.x = (-abs(_33)) + 1.0;
        _9.z += 0.5;
        highp vec2 _3808 = fract(_9.xz);
        _9 = vec4(_3808.x, _9.y, _3808.y, _9.w);
        _9.x = _9.z + _9.x;
        _9.x = fract(_9.x);
        _133 = _561.xy * vec2(vec2(_B_RampUVOffset, _B_RampUVOffset));
        _133.x = _133.y + _133.x;
        _1947 = (_1611.xyz * vec3(0.5)) + vec3(0.5);
        _33 = dot(_528.xy, _1947.xy);
        _25.y = _33 + _B_CardTiltOffset;
        highp vec2 _3854 = _1553.xz + vec2(1.0);
        _1553 = vec4(_1553.x, _3854.x, _1553.z, _3854.y);
        _1553 = (_1553 * vec4(0.25)) + vec4(0.25);
        _1553 = _25.yyyy + (-_1553);
        _1553 = min(abs(_1553), vec4(1.0));
        _1395 = _1553 * _1553;
        _1553 = (_1395 * vec4(0.5)) + _1553;
        _1553 = vec4(_971) * _1553;
        _1553 = exp2(_1553);
        _1992 = _1553.yw + _1553.xz;
        _86.x = dot(_533.xyz, _1947);
        _533 = (-_1219) + _86.xxxx;
        _533 = (_533 * vec4(_B_RampRepeat, _B_RampRepeat, _B_RampAlphaRepeat, _B_RampAlphaRepeat)) + vec4(vec4(_B_RampOffset, _B_RampOffset, _B_RampOffset, _B_RampOffset));
        _1219 = floor(_533);
        _533 += (-_1219);
        _533 = (_533 * _626) + (-_566);
        _566 = _533;
        _566 = clamp(_566, vec4(0.0), vec4(1.0));
        _566 = _133.xxxx + _566.wxyz;
        _891 = _533.xy + vec2(-0.5);
        _891 = (_626.yy * vec2(0.5)) + (-abs(_891));
        _891 = vec2(_875) * _891;
        _891 = clamp(_891, vec2(0.0), vec2(1.0));
        highp vec2 _3964 = (_891 * vec2(-2.0)) + vec2(3.0);
        _528 = vec4(_3964.x, _3964.y, _528.z, _528.w);
        _891 *= _891;
        _3406.x = _566.w;
        _25.x = texture(_3134, pcrStoredUv( _3406)).w;
        _533 = vec4(_566.yz.x, _533.y, _566.yz.y, _533.w);
        _533.y = 0.5;
        _533.w = 0.5;
        _3984 = texture(_3134, pcrStoredUv( _533.xy)).xyz;
        _3990 = texture(_3134, pcrStoredUv( _533.zw)).xyz;
        _566.y = 0.5;
        _3997.y = 0.5;
        _1957.x = texture(_3134, pcrStoredUv( _566.xy)).w;
        _891 = (_528.xy * _891) + vec2(-1.0);
        _891 = (_2123.xx * _891) + vec2(1.0);
        _875 = _25.x * _891.x;
        _86.x = _1957.x * _891.y;
        _971 = _875 * _1992.x;
        _86.x *= _1992.y;
        _875 = (_1992.x * _875) + _86.x;
        _2169 = _875;
        _2169 = clamp(_2169, 0.0, 1.0);
        _971 = max(_86.x, _971);
        _971 = (-_2169) + _971;
        _528.w = (_B_HoloCrossPower * _971) + _2169;
        _875 += 9.9999997473787516355514526367188e-06;
        _86.x /= _875;
        _1410 = (-_3984) + _3990;
        _1410 = (_86.xxx * _1410) + _3984;
        highp vec3 _4090 = _1410 * vec3(vec3(_B_DiffractionIntensity, _B_DiffractionIntensity, _B_DiffractionIntensity));
        _528 = vec4(_4090.x, _4090.y, _4090.z, _528.w);
        _511.y = (-_511.x) + 2.0;
        highp vec2 _4101 = (_511.xy * vec2(0.25)) + vec2(0.23999999463558197021484375);
        _2192 = vec3(_4101.x, _4101.y, _2192.z);
        _133 = _25 + vec2(-1.0, -0.5);
        _86.x = (_133.y * 0.800000011920928955078125) + 0.5;
        _875 = (-_9.x) + 1.0;
        _561.x = (_133.y * (-2.0)) + (-_875);
        _561.y = (_133.y * 2.0) + (-_9.x);
        highp vec2 _4133 = min(abs(_561.xy), vec2(1.0));
        _9 = vec4(_4133.x, _9.y, _9.z, _4133.y);
        highp vec2 _4140 = _9.xw * _9.xw;
        _1410 = vec3(_4140.x, _4140.y, _1410.z);
        highp vec2 _4148 = (_1410.xy * vec2(0.5)) + _9.xw;
        _9 = vec4(_4148.x, _9.y, _9.z, _4148.y);
        highp vec2 _4155 = _9.xw * vec2(_729);
        _9 = vec4(_4155.x, _9.y, _9.z, _4155.y);
        highp vec2 _4160 = exp2(_9.xw);
        _9 = vec4(_4160.x, _9.y, _9.z, _4160.y);
        _86 = (-_2192.xy) + _86.xx;
        _86 = min(abs(_86), vec2(1.0));
        highp vec2 _4174 = _86 * _86;
        _2192 = vec3(_4174.x, _4174.y, _2192.z);
        _86 = (_2192.xy * vec2(0.5)) + _86;
        _86 *= vec2(_956);
        _86 = exp2(_86);
        highp vec2 _4191 = _9.xw * _86;
        _9 = vec4(_4191.x, _9.y, _9.z, _4191.y);
        _1947.x = max(_9.w, _9.x);
        _9.x = min(_1947.x, 1.0);
        _33 = ((-_511.x) * _511.x) + 1.0;
        _3997.x = (_33 * _B_InnerBlockRampOffsetScale) + _533.x;
        _4219 = texture(_3134, pcrStoredUv( _3997)).xyz;
        _133.x = (_A_InnerBlockUseRampAlpha * _133.x) + 1.0;
        _9.x = _133.x * _9.x;
        _9.x = clamp(_9.x, 0.0, 1.0);
        vec3 _4253 = _4219 * vec3(vec3(_B_InnerBlockDiffractionIntensity, _B_InnerBlockDiffractionIntensity, _B_InnerBlockDiffractionIntensity));
        _511 = vec4(_4253.x, _4253.y, _4253.z, _511.w);
        _511.w = _9.x * _B_InnerBlockDiffractionIntensity;
        _9.x = (_9.x * _B_InnerBlockDiffractionIntensity) + _528.w;
        _9.x += 9.9999997473787516355514526367188e-06;
        _9.x = _511.w / _9.x;
        _511 = (-_528) + _511;
        _511 = (_9.xxxx * _511) + _528;
        _9.x = _511.w * _B_Multi1DiffractionIntensityRatio;
        _1947.x = _9.x * _9.x;
        _2441.x = (_498.w * _498.w) + _1947.x;
        _2441.x += 9.9999997473787516355514526367188e-05;
        _1947.x /= _2441.x;
        _2441 = (_511.xyz * vec3(vec3(_B_Multi1DiffractionIntensityRatio, _B_Multi1DiffractionIntensityRatio, _B_Multi1DiffractionIntensityRatio))) + (-_498.xyz);
        _4219 = (_1947.xxx * _2441) + _498.xyz;
        _1947.x = max(_9.x, _498.w);
        _9.x = (-_B_FrontMaskRangeSmooth) + _B_FrontMaskRangeUVY;
        _133.x = _B_FrontMaskRangeSmooth + _B_FrontMaskRangeUVY;
        _133.x = (-_9.x) + _133.x;
        _9.x = (-_9.x) + vs_TEXCOORD0.y;
        _133.x = 1.0 / _133.x;
        _9.x = _133.x * _9.x;
        _9.x = clamp(_9.x, 0.0, 1.0);
        _133.x = (_9.x * (-2.0)) + 3.0;
        _9.x *= _9.x;
        _9.x *= _133.x;
        _133.x = (-_B_HologramFrontMask) + _B_HologramFrontMaskOnAll;
        _9.x = (_9.x * _133.x) + _B_HologramFrontMask;
        _133.x = dot(_345.xyz, -_383.xyz);
        _133.x = log2(_133.x);
        _133.x *= _B_MaskPower;
        _133.x = exp2(_133.x);
        _9.x = (-_133.x) + _9.x;
        _9.x += 1.0;
        _9.x = clamp(_9.x, 0.0, 1.0);
        _9.x = _9.y * _9.x;
        _9.x = _43.x * _9.x;
        _511.w = _9.x * _1947.x;
        _511 = vec4(_4219.x, _4219.y, _4219.z, _511.w);
    }
    else
    {
        _511.x = 0.0;
        _511.y = 0.0;
        _511.z = 0.0;
        _511.w = 0.0;
    }
    _9.x = dot(-_260.xyz, _345.xyz);
    _9.x += _9.x;
    _9.x = (_345.z * (-_9.x)) + (-_260.z);
    _9.x = -_9.x;
    _9.x = clamp(_9.x, 0.0, 1.0);
    _9.x = log2(_9.x);
    _9.x *= _MetallicShininess;
    _9.x = exp2(_9.x);
    _1947.x = _9.x * _MetallicSpecularIntensity;
    _1947.x = (_1947.x * 0.5) + _BaseColorIntensity;
    highp vec3 _4562 = (_1947.xxx * _243) + vec3(-1.0);
    _9 = vec4(_4562.x, _4562.y, _4562.z, _9.w);
    highp vec3 _4571 = (_43.yyy * _9.xyz) + vec3(1.0);
    _9 = vec4(_4571.x, _4571.y, _4571.z, _9.w);
    highp vec3 _4577 = _9.xyz * _243;
    _9 = vec4(_4577.x, _4577.y, _4577.z, _9.w);
    highp vec3 _4584 = clamp(_9.xyz, vec3(0.0), vec3(1.0));
    _9 = vec4(_4584.x, _4584.y, _4584.z, _9.w);
    _484 = _484;
    _484 = clamp(_484, vec4(0.0), vec4(1.0));
    _511 = _511;
    _511 = clamp(_511, vec4(0.0), vec4(1.0));
    highp vec3 _4601 = _9.xyz * _9.xyz;
    _9 = vec4(_4601.x, _4601.y, _4601.z, _9.w);
    _33 = dot(_9.xyz, vec3(0.4121656119823455810546875, 0.536275207996368408203125, 0.0514575652778148651123046875));
    _43.x = dot(_9.xyz, vec3(0.21185910701751708984375, 0.680718958377838134765625, 0.107406578958034515380859375));
    _9.x = dot(_9.xyz, vec3(0.0883097946643829345703125, 0.281847417354583740234375, 0.630261361598968505859375));
    _243.x = log2(_33);
    _243.y = log2(_43.x);
    _243.z = log2(_9.x);
    highp vec3 _4641 = _243 * vec3(0.3333333432674407958984375);
    _9 = vec4(_4641.x, _4641.y, _4641.z, _9.w);
    highp vec3 _4646 = exp2(_9.xyz);
    _9 = vec4(_4646.x, _4646.y, _4646.z, _9.w);
    _43.x = dot(_9.xyz, vec3(0.2104542553424835205078125, 0.793617784976959228515625, 0.004072046838700771331787109375));
    _43.y = dot(_9.xyz, vec3(1.9779984951019287109375, -2.428592205047607421875, 0.4505937099456787109375));
    _43.z = dot(_9.xyz, vec3(0.025904037058353424072265625, 0.782771766185760498046875, -0.8086757659912109375));
    highp vec3 _4677 = _484.xyz * _484.xyz;
    _9 = vec4(_4677.x, _4677.y, _4677.z, _9.w);
    _33 = dot(_9.xyz, vec3(0.4121656119823455810546875, 0.536275207996368408203125, 0.0514575652778148651123046875));
    _729 = dot(_9.xyz, vec3(0.21185910701751708984375, 0.680718958377838134765625, 0.107406578958034515380859375));
    _9.x = dot(_9.xyz, vec3(0.0883097946643829345703125, 0.281847417354583740234375, 0.630261361598968505859375));
    _243.x = log2(_33);
    _243.y = log2(_729);
    _243.z = log2(_9.x);
    highp vec3 _4701 = _243 * vec3(0.3333333432674407958984375);
    _9 = vec4(_4701.x, _4701.y, _4701.z, _9.w);
    highp vec3 _4706 = exp2(_9.xyz);
    _9 = vec4(_4706.x, _4706.y, _4706.z, _9.w);
    _243.x = dot(_9.xyz, vec3(0.2104542553424835205078125, 0.793617784976959228515625, 0.004072046838700771331787109375));
    _243.y = dot(_9.xyz, vec3(1.9779984951019287109375, -2.428592205047607421875, 0.4505937099456787109375));
    _243.z = dot(_9.xyz, vec3(0.025904037058353424072265625, 0.782771766185760498046875, -0.8086757659912109375));
    highp vec3 _4725 = _511.xyz * _511.xyz;
    _9 = vec4(_4725.x, _4725.y, _4725.z, _9.w);
    _33 = dot(_9.xyz, vec3(0.4121656119823455810546875, 0.536275207996368408203125, 0.0514575652778148651123046875));
    _729 = dot(_9.xyz, vec3(0.21185910701751708984375, 0.680718958377838134765625, 0.107406578958034515380859375));
    _9.x = dot(_9.xyz, vec3(0.0883097946643829345703125, 0.281847417354583740234375, 0.630261361598968505859375));
    _260.x = log2(_33);
    _260.y = log2(_729);
    _260.z = log2(_9.x);
    highp vec3 _4750 = _260.xyz * vec3(0.3333333432674407958984375);
    _9 = vec4(_4750.x, _4750.y, _4750.z, _9.w);
    highp vec3 _4755 = exp2(_9.xyz);
    _9 = vec4(_4755.x, _4755.y, _4755.z, _9.w);
    _260.x = dot(_9.xyz, vec3(0.2104542553424835205078125, 0.793617784976959228515625, 0.004072046838700771331787109375));
    _260.y = dot(_9.xyz, vec3(1.9779984951019287109375, -2.428592205047607421875, 0.4505937099456787109375));
    _260.z = dot(_9.xyz, vec3(0.025904037058353424072265625, 0.782771766185760498046875, -0.8086757659912109375));
    _9.x = _484.w * _A_Blend_AlphaBlend;
    _9.x = clamp(_9.x, 0.0, 1.0);
    _4781.x = _511.w * _B_Blend_AlphaBlend;
    _4781.x = clamp(_4781.x, 0.0, 1.0);
    _133.x = _4781.x + _9.x;
    _133.x = max(_133.x, 9.9999997473787516355514526367188e-05);
    _133.x = _4781.x / _133.x;
    highp vec3 _4813 = (-_243) + _260.xyz;
    _260 = vec4(_4813.x, _4813.y, _4813.z, _260.w);
    _243 = (_133.xxx * _260.xyz) + _243;
    _133 = (-_43.yz) + _243.yz;
    _133.x = dot(_133, _133);
    _133.x = sqrt(_133.x);
    _33 = _A_Blend_AlphaBlendScaleByDist + (-1.0);
    _133.y = _33 * _133.x;
    _729 = _B_Blend_AlphaBlendScaleByDist + (-1.0);
    _133.x *= _729;
    _133 = max(_133, vec2(1.0));
    _4781.x = _133.x * _4781.x;
    _9.x = (_9.x * _133.y) + _4781.x;
    _9.x = min(_9.x, 1.0);
    _4781 = (-_43) + _243;
    highp vec3 _4885 = (_9.xxx * _4781) + _43;
    _9 = vec4(_4885.x, _4885.y, _4885.z, _9.w);
    _43.x = dot(_9.xyz, vec3(1.0, 0.3963377773761749267578125, 0.21580375730991363525390625));
    _43.y = dot(_9.xyz, vec3(1.0, -0.1055613458156585693359375, -0.06385417282581329345703125));
    _43.z = dot(_9.xyz, vec3(1.0, -0.089484177529811859130859375, -1.2914855480194091796875));
    highp vec3 _4902 = _43 * _43;
    _9 = vec4(_4902.x, _4902.y, _4902.z, _9.w);
    highp vec3 _4908 = _43 * _9.xyz;
    _9 = vec4(_4908.x, _4908.y, _4908.z, _9.w);
    _43.x = dot(_9.xyz, vec3(4.076741695404052734375, -3.30771160125732421875, 0.2309699356555938720703125));
    _43.y = dot(_9.xyz, vec3(-1.26843798160552978515625, 2.60975742340087890625, -0.341319382190704345703125));
    _43.z = dot(_9.xyz, vec3(-0.0041960864327847957611083984375, -0.70341861248016357421875, 1.7076146602630615234375));
    highp vec3 _4925 = max(_43, vec3(0.0));
    _9 = vec4(_4925.x, _4925.y, _4925.z, _9.w);
    highp vec3 _4930 = sqrt(_9.xyz);
    _9 = vec4(_4930.x, _4930.y, _4930.z, _9.w);
    _43 = _484.www * _484.xyz;
    _243 = _511.www * _511.xyz;
    _243 *= vec3(vec3(_B_Blend_Add, _B_Blend_Add, _B_Blend_Add));
    _43 = (_43 * vec3(_A_Blend_Add)) + _243;
    highp vec3 _4968 = _9.xyz + _43;
    _9 = vec4(_4968.x, _4968.y, _4968.z, _9.w);
    _43 = _484.xyz * vec3(vec3(_A_Blend_Emissive, _A_Blend_Emissive, _A_Blend_Emissive));
    _43 = _511.www * _43;
    _43 *= vec3(vec3(_B_Blend_Emissive, _B_Blend_Emissive, _B_Blend_Emissive));
    _243 = (-_9.xyz) + vec3(1.00100004673004150390625);
    _5010 = greaterThanEqual(vec4(0.0), _243.xyzx).xyz;
    _243.x = float(_5010.x);
    _243.y = float(_5010.y);
    _243.z = float(_5010.z);
    _33 = _243.y + _243.x;
    _33 = _243.z + _33;
    _33 = (-_33) + 1.0;
    _5039 = 0.0 >= _33;
    if (_5039)
    {
        _243 = _9.xyz;
        _243 = clamp(_243, vec3(0.0), vec3(1.0));
        _243 *= _243;
        _33 = dot(_243, vec3(0.4121656119823455810546875, 0.536275207996368408203125, 0.0514575652778148651123046875));
        _729 = dot(_243, vec3(0.21185910701751708984375, 0.680718958377838134765625, 0.107406578958034515380859375));
        _243.x = dot(_243, vec3(0.0883097946643829345703125, 0.281847417354583740234375, 0.630261361598968505859375));
        _260.x = log2(_33);
        _260.y = log2(_729);
        _260.z = log2(_243.x);
        _243 = _260.xyz * vec3(0.3333333432674407958984375);
        _243 = exp2(_243);
        _33 = dot(_243, vec3(0.2104542553424835205078125, 0.793617784976959228515625, 0.004072046838700771331787109375));
        _260.y = dot(_243, vec3(1.9779984951019287109375, -2.428592205047607421875, 0.4505937099456787109375));
        _260.z = dot(_243, vec3(0.025904037058353424072265625, 0.782771766185760498046875, -0.8086757659912109375));
        _243 = _9.xyz + vec3(-1.0);
        _243 = max(_243, vec3(0.0));
        _729 = _243.y + _243.x;
        _729 = _243.z + _729;
        _729 = min(_729, 1.0);
        _729 = log2(_729);
        _729 *= _OverExposurePow;
        _729 = exp2(_729);
        _260.x = _33 + _729;
        _484.x = dot(_260.xyz, vec3(1.0, 0.3963377773761749267578125, 0.21580375730991363525390625));
        _484.y = dot(_260.xyz, vec3(1.0, -0.1055613458156585693359375, -0.06385417282581329345703125));
        _484.z = dot(_260.xyz, vec3(1.0, -0.089484177529811859130859375, -1.2914855480194091796875));
        highp vec3 _5129 = _484.xyz * _484.xyz;
        _260 = vec4(_5129.x, _5129.y, _5129.z, _260.w);
        highp vec3 _5136 = _484.xyz * _260.xyz;
        _260 = vec4(_5136.x, _5136.y, _5136.z, _260.w);
        _484.x = dot(_260.xyz, vec3(4.076741695404052734375, -3.30771160125732421875, 0.2309699356555938720703125));
        _484.y = dot(_260.xyz, vec3(-1.26843798160552978515625, 2.60975742340087890625, -0.341319382190704345703125));
        _484.z = dot(_260.xyz, vec3(-0.0041960864327847957611083984375, -0.70341861248016357421875, 1.7076146602630615234375));
        highp vec3 _5153 = max(_484.xyz, vec3(0.0));
        _260 = vec4(_5153.x, _5153.y, _5153.z, _260.w);
        highp vec3 _5158 = sqrt(_260.xyz);
        _9 = vec4(_5158.x, _5158.y, _5158.z, _9.w);
        _33 = _729 * _OverExposureEmissiveIntensity;
        _43 = (_243 * vec3(_33)) + _43;
    }
    _33 = dot(_345.xyz, -_383.xyz);
    _33 = log2(_33);
    _33 *= _EmissiveFrontMaskPower;
    _33 = exp2(_33);
    _33 = (-_33) + _EmissiveFrontMask;
    _33 += 1.0;
    _33 = clamp(_33, 0.0, 1.0);
    highp vec3 _5202 = vec3(_33) * _43;
    _5198 = vec4(_5202.x, _5202.y, _5202.z, _5198.w);
    _5205 = vec4(_9.xyz.x, _9.xyz.y, _9.xyz.z, _5205.w);
    _5205.w = 1.0;
    _5198.w = 1.0;
}
