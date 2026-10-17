'use client'

import * as React from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

export interface ProceduralNebulaProps {
  tier?: 'high' | 'low' | 'fallback'
  opacity?: number
}

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = `
  uniform float uTime;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;
  varying vec2 vUv;

  vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

  float snoise(vec2 v){
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
             -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy) );
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1;
    i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
    + i.x + vec3(0.0, i1.x, 1.0 ));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
      dot(x12.zw,x12.zw)), 0.0);
    m = m*m ;
    m = m*m ;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    float t = uTime * 0.06;
    float n1 = snoise(uv * 1.3 + vec2(t * 0.3, t * 0.15));
    float n2 = snoise(uv * 2.6 - vec2(t * 0.2, t * 0.4));
    float combined = (n1 * 0.6 + n2 * 0.4 + 1.0) * 0.5;
    float noise = smoothstep(0.1, 0.9, combined);

    vec3 col = mix(uColorA, uColorB, noise);
    float dist = length(uv);
    float vignette = smoothstep(1.3, 0.2, dist);
    float alpha = noise * vignette * uOpacity;

    gl_FragColor = vec4(col, alpha);
  }
`

export function ProceduralNebula({ tier = 'high', opacity = 0.35 }: ProceduralNebulaProps) {
  const materialRef = React.useRef<THREE.ShaderMaterial>(null)

  const uniforms = React.useMemo(
    () => ({
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color('#38bdf8') }, // --nx-space-cyan
      uColorB: { value: new THREE.Color('#00f0ff') }, // --nx-space-ai
      uOpacity: { value: opacity },
    }),
    [opacity],
  )

  useFrame((state) => {
    if (materialRef.current && tier !== 'fallback' && materialRef.current.uniforms.uTime) {
      const elapsed = state.clock ? state.clock.getElapsedTime() : 0
      materialRef.current.uniforms.uTime.value = tier === 'low' ? 0.5 : elapsed
    }
  })

  React.useEffect(() => {
    return () => {
      materialRef.current?.dispose()
    }
  }, [])

  return (
    <mesh position={[0, 0, -3.5]}>
      <planeGeometry args={[22, 14, 1, 1]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  )
}
