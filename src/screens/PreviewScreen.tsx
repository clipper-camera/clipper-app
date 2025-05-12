import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Dimensions, TextInput, PanResponder, Animated } from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Video, ResizeMode } from 'expo-av';
import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { captureRef } from 'react-native-view-shot';
import { TextOverlay } from '../services/uploadService';
import { mediaCacheService } from '../services/mediaCacheService';
import { settingsService } from '../services/settingsService';

type RootStackParamList = {
  Home: undefined;
  Preview: { 
    mediaUri: string; 
    mediaType: 'image' | 'video'; 
    canSend: boolean;
    textOverlays?: TextOverlay[];
  };
  Contacts: { mediaUri: string; mediaType: 'image' | 'video', textOverlays?: TextOverlay[] };
};

type PreviewScreenProps = NativeStackScreenProps<RootStackParamList, 'Preview'>;

interface ExtendedTextOverlay extends TextOverlay {
  initialDistance?: number;
  initialScale?: number;
  initialAngle?: number;
  initialRotation?: number;
}

export default function PreviewScreen() {
  const navigation = useNavigation<PreviewScreenProps['navigation']>();
  const route = useRoute<PreviewScreenProps['route']>();
  const [mediaUri, setMediaUri] = useState<string>(route.params?.mediaUri || '');
  const [mediaType, setMediaType] = useState<'image' | 'video'>(route.params?.mediaType || 'image');
  const [canSend, setCanSend] = useState<boolean>(route.params?.canSend || false);
  const [textOverlays, setTextOverlays] = useState<TextOverlay[]>(route.params?.textOverlays || []);
  const [isAddingText, setIsAddingText] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [activeTextId, setActiveTextId] = useState<string | null>(null);
  const viewRef = useRef<View>(null);
  const [viewDimensions, setViewDimensions] = useState({ width: 0, height: 0 });
  const lastTouchCountRef = useRef<{ [key: string]: number }>({});
  const gestureStateRef = useRef<{ 
    [key: string]: { 
      initialDistance: number;
      initialAngle: number;
      initialTouch1: { x: number; y: number };
      initialTouch2: { x: number; y: number };
      initialScale: number;
      initialRotation: number;
    } 
  }>({});

  const handleRetake = () => {
    navigation.pop();
  };

  const handleProceed = () => {
    navigation.navigate('Contacts', { 
      mediaUri, 
      mediaType,
      textOverlays: textOverlays.length > 0 ? textOverlays : undefined
    });
  };

  const handleAddText = () => {
    setIsAddingText(true);
  };

  const handleTextSubmit = () => {
    if (textInput.trim()) {
      // Calculate text width in approximate
      const fontSize = 20;
      const averageCharWidth = fontSize * 0.6; // Approximate width/char 
      const textWidth = Math.min(
        textInput.length * averageCharWidth,
        viewDimensions.width - 40 // Maximum width with padding
      );
      // Create new text overlay
      const newTextOverlay: ExtendedTextOverlay = {
        id: Date.now().toString(),
        text: textInput,
        position: { 
          x: viewDimensions.width / 2 - textWidth / 2,
          y: viewDimensions.height / 2 - 25
        },
        size: { 
          width: textWidth,
          height: 50 
        },
        rotation: 0,
        scale: 1,
        color: '#FFFFFF',
        fontSize: fontSize,
        fontFamily: 'Open Sans',
      };
      setTextOverlays([...textOverlays, newTextOverlay]);
      setTextInput('');
    }
    setIsAddingText(false);
  };

  const handleDismissTextInput = () => {
    setIsAddingText(false);
    setTextInput('');
  };

  const createPanResponder = (id: string) => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt, gestureState) => {
        if (!canSend) return;
        setActiveTextId(id);
        if (gestureStateRef.current[id]) {
          delete gestureStateRef.current[id];
        }
      },
      onPanResponderMove: (evt, gestureState) => {
        if (!canSend) return;
        
        evt.persist();
        
        // Store touch points immediately
        const touches = evt.nativeEvent.touches;
        const touchCount = touches?.length || 0;
        
        setTextOverlays(prev => 
          prev.map(overlay => {
            if (overlay.id != id) {
              return overlay;
            }
          
            let newX = overlay.position.x;
            let newY = overlay.position.y;
            let newScale = overlay.scale;
            let newRotation = overlay.rotation;

            // Initialize gesture state if it doesn't exist
            let isFirstMove = false;
            if (!gestureStateRef.current[id]) {
              const touchX1 = touches[0].pageX;
              const touchY1 = touches[0].pageY;
              let touchX2 = touches[0].pageX;
              let touchY2 = touches[0].pageY;
              if(touchCount >= 2) {
                touchX2 = touches[1].pageX;
                touchY2 = touches[1].pageY;
              }
              
              gestureStateRef.current[id] = {
                initialDistance: 0,
                initialAngle: 0,
                initialTouch1: { x: touchX1, y: touchY1 },
                initialTouch2: { x: touchX2, y: touchY2 },
                initialScale: overlay.scale,
                initialRotation: overlay.rotation
              };
              lastTouchCountRef.current[id] = touchCount;
              isFirstMove = true;
            }
                        
            // Single touch point, move the text overlay xy based on the touch point
            if (lastTouchCountRef.current[id] === 1 && touchCount == 1) {
              const touchX = touches[0].pageX;
              const touchY = touches[0].pageY;

              // Calculate movement relative to last touch point
              const lastTouch = gestureStateRef.current[id].initialTouch1;
              const dx = touchX - lastTouch.x;
              const dy = touchY - lastTouch.y;

              // Update position based on movement
              newX = overlay.position.x + dx;
              newY = overlay.position.y + dy;

              // Update the last touch point for next movement
              gestureStateRef.current[id].initialTouch1 = { x: touchX, y: touchY };
              lastTouchCountRef.current[id] = touchCount;
            }

            // If we transitioning from 1 to 2 touches record the new second touch point
            if (lastTouchCountRef.current[id] === 1 && touchCount >= 2) {
              const touch1X = touches[0].pageX;
              const touch1Y = touches[0].pageY;
              const touch2X = touches[1].pageX;
              const touch2Y = touches[1].pageY;
              gestureStateRef.current[id].initialTouch1 = { x: touch1X, y: touch1Y };
              gestureStateRef.current[id].initialTouch2 = { x: touch2X, y: touch2Y };
              lastTouchCountRef.current[id] = touchCount;
              isFirstMove = true;
            }
            
            // We have two touch points, allow the user to scale and rotate the text overlay
            if (lastTouchCountRef.current[id] >= 2 && touchCount >= 2) {
              const touch1X = touches[0].pageX;
              const touch1Y = touches[0].pageY;
              const touch2X = touches[1].pageX;
              const touch2Y = touches[1].pageY;

              // Calculate current distance and angle
              const currentDistance = Math.sqrt(Math.pow(touch2X - touch1X, 2) +  Math.pow(touch2Y - touch1Y, 2));
              const currentAngle = Math.atan2(touch2Y - touch1Y, touch2X - touch1X) * (180 / Math.PI);

              // Store initial distance and angle
              if (isFirstMove) {
                gestureStateRef.current[id].initialDistance = currentDistance;
                gestureStateRef.current[id].initialAngle = currentAngle;
              } 
              
              // Calculate scale change
              const scaleChange = currentDistance / gestureStateRef.current[id].initialDistance;
              newScale = gestureStateRef.current[id].initialScale * scaleChange;

              // Calculate rotation change
              const angleChange = currentAngle - gestureStateRef.current[id].initialAngle;
              newRotation = (gestureStateRef.current[id].initialRotation + angleChange) % 360;

              // Lets move the text overlay based on how the midpoint moves
              const lastTouch1 = gestureStateRef.current[id].initialTouch1;
              const dx1 = touch1X - lastTouch1.x;
              const dy1 = touch1Y - lastTouch1.y;
              const lastTouch2 = gestureStateRef.current[id].initialTouch2;
              const dx2 = touch2X - lastTouch2.x;
              const dy2 = touch2Y - lastTouch2.y;
              newX = overlay.position.x + dx1;
              newY = overlay.position.y + dy1;

              gestureStateRef.current[id].initialTouch1 = { x: touch1X, y: touch1Y };
              gestureStateRef.current[id].initialTouch2 = { x: touch2X, y: touch2Y };
              lastTouchCountRef.current[id] = touchCount;
            }

            return { 
              ...overlay, 
              position: { x: newX, y: newY },
              scale: newScale,
              rotation: newRotation
            };
          })
        );
      },
      onPanResponderRelease: () => {
        if (!canSend) return;
        setActiveTextId(null);
        delete gestureStateRef.current[id];
        lastTouchCountRef.current[id] = 0;
      },
    });
  };

  // Add this function to handle remote media
  const handleRemoteMedia = async (url: string) => {
    try {
      const settings = await settingsService.getSettings();
      const fullMediaUrl = `${settings.apiEndpoint}${url}`;
      const cachedUri = await mediaCacheService.getMedia(fullMediaUrl);
      if (cachedUri) {
        setMediaUri(cachedUri);
      }
    } catch (error) {
      console.error('Error handling remote media:', error);
    }
  };

  // Update the useEffect to handle remote media
  useEffect(() => {
    if (route.params?.mediaUri) {
      if (route.params.mediaUri.startsWith('http')) {
        handleRemoteMedia(route.params.mediaUri);
      } else {
        setMediaUri(route.params.mediaUri);
      }
    }
  }, [route.params?.mediaUri]);

  return (
    <View 
      ref={viewRef} 
      style={styles.container}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setViewDimensions({ width, height });
      }}
    >
      <Pressable 
        style={styles.mediaContainer}
        onPress={() => {
          if (!canSend) {
            navigation.pop();
          }
        }}
      >
        {mediaType === 'video' ? (
          <Video
            source={{ uri: mediaUri }}
            style={styles.media}
            resizeMode={ResizeMode.COVER}
            shouldPlay
            isLooping
          />
        ) : (
          <Image
            source={{ uri: mediaUri }}
            style={styles.media}
            contentFit="cover"
          />
        )}
      </Pressable>
      
      {textOverlays.map(overlay => {
        const panResponder = createPanResponder(overlay.id);
        return (
          <Animated.View
            key={overlay.id}
            style={[
              styles.textOverlay,
              {
                position: 'absolute',
                left: overlay.position.x,
                top: overlay.position.y,
                transform: [
                  { translateX: -overlay.size.width / 2 },
                  { translateY: -overlay.size.height / 2 },
                  { rotate: `${overlay.rotation}deg` },
                  { scale: overlay.scale },
                  { translateX: overlay.size.width / 2 },
                  { translateY: overlay.size.height / 2 }
                ],
                zIndex: activeTextId === overlay.id ? 1 : 0,
              },
            ]}
            {...panResponder.panHandlers}
          >
            <Text style={[
              styles.overlayText,
              {
                color: overlay.color,
                fontSize: overlay.fontSize,
                fontFamily: overlay.fontFamily,
              }
            ]}>
              {overlay.text}
            </Text>
          </Animated.View>
        );
      })}

      {isAddingText && (
        <Pressable 
          style={styles.textInputOverlay}
          onPress={handleDismissTextInput}
        >
          <View style={styles.textInputContainer}>
            <TextInput
              style={styles.textInput}
              value={textInput}
              onChangeText={setTextInput}
              placeholder="Enter text"
              placeholderTextColor="#999"
              autoFocus
              multiline
              textAlignVertical="top"
              onBlur={handleDismissTextInput}
            />
            <Pressable onPress={handleTextSubmit} style={styles.submitButton}>
              <Text style={styles.submitButtonText}>Add</Text>
            </Pressable>
          </View>
        </Pressable>
      )}

      <View style={styles.buttonContainer}>
        {canSend && (
          <>
            <Pressable onPress={handleRetake} style={styles.button}>
              <FontAwesome6 name="arrow-rotate-left" size={32} color="white" />
            </Pressable>
            <Pressable onPress={handleAddText} style={styles.button}>
              <FontAwesome6 name="font" size={32} color="white" />
            </Pressable>
            <Pressable onPress={handleProceed} style={styles.button}>
              <FontAwesome6 name="paper-plane" size={32} color="white" />
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  mediaContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  media: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 44,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 30,
  },
  button: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textInputOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  textInputContainer: {
    marginBottom: 120,
    marginHorizontal: 20,
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    padding: 10,
    borderRadius: 10,
    maxHeight: 200,
  },
  textInput: {
    flex: 1,
    color: 'white',
    padding: 10,
    fontSize: 16,
    minHeight: 40,
    maxHeight: 180,
  },
  submitButton: {
    padding: 10,
    backgroundColor: '#007AFF',
    borderRadius: 5,
    marginLeft: 10,
  },
  submitButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  textOverlay: {
    position: 'absolute',
    padding: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 5,
  },
  overlayText: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
  },
}); 