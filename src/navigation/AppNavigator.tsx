import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text } from 'react-native';
import HomeScreen from '../screens/HomeScreen';
import SettingsScreen from '../screens/SettingsScreen';
import GameScreen from '../screens/GameScreen';
import LobbyScreen from '../screens/LobbyScreen';
import OnlineMatchScreen from '../screens/OnlineMatchScreen';
import ProgressScreen from '../screens/ProgressScreen';
// MotionTest rig retired (Wonder P2): worklets-core native is excluded so its
// useFrameProcessor redboxes on mount. Game uses SAM-only verdicts now.
// Screen file kept for reference; route removed so it is unreachable.

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#fff', borderTopColor: '#FFE55C', borderTopWidth: 3, height: 62, paddingBottom: 6 },
        tabBarActiveTintColor: '#FF2E63',
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarLabelStyle: { fontWeight: '800', fontSize: 11 },
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeScreen}
        options={{ title: 'Home', tabBarIcon: () => <Text style={{ fontSize: 18 }}>🏠</Text> }}
      />
      <Tab.Screen
        name="Progress"
        component={ProgressScreen}
        options={{ tabBarIcon: () => <Text style={{ fontSize: 18 }}>📈</Text> }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ tabBarIcon: () => <Text style={{ fontSize: 18 }}>⚙️</Text> }}
      />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        {/* App opens directly to homepage (MainTabs -> Home) */}
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen name="Lobby" component={LobbyScreen} />
        <Stack.Screen name="OnlineMatch" component={OnlineMatchScreen} />
        <Stack.Screen
          name="Game"
          component={GameScreen}
          options={{ headerShown: true, headerTitle: 'Simon Says', headerStyle: { backgroundColor: '#FFD93D' }, headerTintColor: '#1a1a2e', headerTitleStyle: { fontWeight: '900' } }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
