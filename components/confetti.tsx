import { useEffect, useMemo } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

const { width: W, height: H } = Dimensions.get('window');
const COLORS = ['#ff6b35', '#65efc1', '#f5c842', '#c77dff', '#4cc9f0', '#ff9f1c'];
const COUNT = 60;

type Particle = {
  x: number;
  color: string;
  size: number;
  delay: number;
  duration: number;
  rotate: number;
};

function randomParticles(): Particle[] {
  return Array.from({ length: COUNT }, (_, i) => ({
    x: Math.random() * W,
    color: COLORS[i % COLORS.length],
    size: 6 + Math.random() * 8,
    delay: Math.random() * 600,
    duration: 1200 + Math.random() * 800,
    rotate: Math.random() * 720 - 360,
  }));
}

function ConfettiPiece({ particle }: { particle: Particle }) {
  const y = useSharedValue(-20);
  const opacity = useSharedValue(1);
  const rotate = useSharedValue(0);

  // Intentionally run once on mount: this animates the particle in from its
  // initial random delay/duration/rotate, and shared values are stable
  // refs that don't need to be in the dep array.
  useEffect(() => {
    y.value = withDelay(
      particle.delay,
      withTiming(H + 40, { duration: particle.duration, easing: Easing.in(Easing.quad) })
    );
    opacity.value = withDelay(
      particle.delay + particle.duration * 0.7,
      withTiming(0, { duration: particle.duration * 0.3 })
    );
    rotate.value = withDelay(
      particle.delay,
      withTiming(particle.rotate, { duration: particle.duration })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }, { rotate: `${rotate.value}deg` }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        style,
        {
          position: 'absolute',
          left: particle.x,
          top: 0,
          width: particle.size,
          height: particle.size * 0.5,
          borderRadius: 2,
          backgroundColor: particle.color,
        },
      ]}
    />
  );
}

export function Confetti({ onDone }: { onDone?: () => void }) {
  const particles = useMemo(() => randomParticles(), []);
  const maxDuration = Math.max(...particles.map((p) => p.delay + p.duration));

  // Intentionally run once on mount to arm a single timeout for the whole
  // burst — Confetti is mounted fresh per celebration, not re-rendered.
  useEffect(() => {
    if (!onDone) return;
    const t = setTimeout(onDone, maxDuration + 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {particles.map((p, i) => (
        <ConfettiPiece key={i} particle={p} />
      ))}
    </View>
  );
}
