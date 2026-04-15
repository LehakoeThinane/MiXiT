import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

type LiquidBackdropProps = {
  dimmerOpacity?: number;
};

function createLoop(value: Animated.Value, duration: number, delayMs = 0) {
  return Animated.loop(
    Animated.sequence([
      Animated.delay(delayMs),
      Animated.timing(value, {
        toValue: 1,
        duration,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      }),
      Animated.timing(value, {
        toValue: 0,
        duration,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      }),
    ])
  );
}

export function LiquidBackdrop({ dimmerOpacity = 0.6 }: LiquidBackdropProps) {
  const orbA = useRef(new Animated.Value(0)).current;
  const orbB = useRef(new Animated.Value(0)).current;
  const orbC = useRef(new Animated.Value(0)).current;
  const orbD = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loops = [
      createLoop(orbA, 18000, 0),
      createLoop(orbB, 22000, 900),
      createLoop(orbC, 20000, 1400),
      createLoop(orbD, 24000, 500),
    ];

    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [orbA, orbB, orbC, orbD]);

  return (
    <View pointerEvents="none" style={styles.liquidBackground}>
      <Animated.View
        style={[
          styles.orb,
          styles.orbCoral,
          {
            transform: [
              { translateX: orbA.interpolate({ inputRange: [0, 1], outputRange: [-20, 36] }) },
              { translateY: orbA.interpolate({ inputRange: [0, 1], outputRange: [-16, 48] }) },
              { scale: orbA.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) },
            ],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.orb,
          styles.orbNavy,
          {
            transform: [
              { translateX: orbB.interpolate({ inputRange: [0, 1], outputRange: [24, -40] }) },
              { translateY: orbB.interpolate({ inputRange: [0, 1], outputRange: [18, -38] }) },
              { scale: orbB.interpolate({ inputRange: [0, 1], outputRange: [1.1, 0.92] }) },
            ],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.orb,
          styles.orbRose,
          {
            transform: [
              { translateX: orbC.interpolate({ inputRange: [0, 1], outputRange: [-12, 28] }) },
              { translateY: orbC.interpolate({ inputRange: [0, 1], outputRange: [24, -44] }) },
              { scale: orbC.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.16] }) },
            ],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.orb,
          styles.orbTeal,
          {
            transform: [
              { translateX: orbD.interpolate({ inputRange: [0, 1], outputRange: [18, -34] }) },
              { translateY: orbD.interpolate({ inputRange: [0, 1], outputRange: [-26, 36] }) },
              { scale: orbD.interpolate({ inputRange: [0, 1], outputRange: [1.04, 1.22] }) },
            ],
          },
        ]}
      />
      <View style={[styles.liquidScrim, { backgroundColor: `rgba(7, 9, 20, ${dimmerOpacity})` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  liquidBackground: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  liquidScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  orb: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    opacity: 0.52,
  },
  orbCoral: {
    top: -120,
    left: -40,
    backgroundColor: '#ff6b35',
  },
  orbNavy: {
    top: 80,
    right: -110,
    backgroundColor: '#2d3561',
  },
  orbRose: {
    bottom: 120,
    left: 12,
    backgroundColor: '#9f4f77',
  },
  orbTeal: {
    bottom: -90,
    right: -36,
    backgroundColor: '#06d6a0',
  },
});

