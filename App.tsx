import React, { useState, useRef, useEffect } from 'react';
import {
  SafeAreaView,
  TextInput,
  FlatList,
  Text,
  View,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  Alert,
  StatusBar,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNEventSource from 'react-native-sse';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  error?: boolean;
  timestamp: Date;
  type?: 'text' | 'voice';
}

type AuthResponse = {
  token: string;
  session_id: string;
  expires_at: number;
};

type Theme = 'light' | 'dark';
type ConversationMode = 'text' | 'voice_record' | 'voice_live';

const API_BASE_URL = 'http://192.168.0.186:8080';
const TOKEN_KEY = 'auth_token';
const SESSION_KEY = 'session_id';
const TOKEN_EXPIRY_KEY = 'token_expiry';

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hi! I\'m your AI banking assistant. How can I help you today?',
      timestamp: new Date(),
      type: 'text',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [theme, setTheme] = useState<Theme>('dark');
  const [conversationMode, setConversationMode] = useState<ConversationMode>('text');
  
  // Voice states
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceLevel, setVoiceLevel] = useState(0);
  
  const flatListRef = useRef<FlatList>(null);
  const eventSourceRef = useRef<RNEventSource | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const currentMessageRef = useRef<string>('');
  
  // Voice refs
  const recordingRef = useRef<any>(null);
  const audioRef = useRef<any>(null);
  const animationRef = useRef(new Animated.Value(0)).current;
  
  // Authentication state
  const tokenRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const tokenExpiryRef = useRef<number | null>(null);

  useEffect(() => {
    initializeAuth();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (xhrRef.current) {
        xhrRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    if (messages.length > 1) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  // Voice level animation
  useEffect(() => {
    if (isRecording || isListening) {
      const animate = () => {
        Animated.sequence([
          Animated.timing(animationRef, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(animationRef, {
            toValue: 0,
            duration: 800,
            useNativeDriver: true,
          }),
        ]).start(() => {
          if (isRecording || isListening) {
            animate();
          }
        });
      };
      animate();
    }
  }, [isRecording, isListening]);

  const initializeAuth = async () => {
    try {
      setAuthLoading(true);
      
      const [storedToken, storedSessionId, storedExpiry] = await Promise.all([
        AsyncStorage.getItem(TOKEN_KEY),
        AsyncStorage.getItem(SESSION_KEY),
        AsyncStorage.getItem(TOKEN_EXPIRY_KEY),
      ]);

      const now = Date.now() / 1000;
      const expiry = storedExpiry ? parseInt(storedExpiry) : 0;

      if (storedToken && storedSessionId && expiry > now) {
        console.log('Using existing valid token');
        tokenRef.current = storedToken;
        sessionIdRef.current = storedSessionId;
        tokenExpiryRef.current = expiry;
        setIsAuthenticated(true);
      } else {
        console.log('Token expired or not found, authenticating...');
        await authenticate();
      }
    } catch (error) {
      console.error('Auth initialization error:', error);
      Alert.alert(
        'Authentication Error',
        'Failed to initialize authentication. Please try again.',
        [{ text: 'Retry', onPress: authenticate }]
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const authenticate = async () => {
    try {
      console.log('Authenticating with server...');
      const response = await fetch(`${API_BASE_URL}/auth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          user_id: 'mobile-user',
          password: '',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Authentication failed: ${response.status}`);
      }

      const authData: AuthResponse = await response.json();
      
      if (!authData.token || !authData.session_id) {
        throw new Error('Invalid authentication response');
      }

      tokenRef.current = authData.token;
      sessionIdRef.current = authData.session_id;
      tokenExpiryRef.current = authData.expires_at;

      await Promise.all([
        AsyncStorage.setItem(TOKEN_KEY, authData.token),
        AsyncStorage.setItem(SESSION_KEY, authData.session_id),
        AsyncStorage.setItem(TOKEN_EXPIRY_KEY, authData.expires_at.toString()),
      ]);

      setIsAuthenticated(true);
      console.log('Authentication successful');
      
    } catch (error) {
      console.error('Authentication error:', error);
      Alert.alert(
        'Authentication Failed',
        error instanceof Error ? error.message : 'Failed to connect to the server. Please check your connection and try again.',
        [
          { 
            text: 'Retry', 
            onPress: () => authenticate()
          },
          {
            text: 'Check Server',
            onPress: () => checkServerStatus()
          }
        ]
      );
    }
  };

  const checkServerStatus = async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${API_BASE_URL}/health`, {
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (response.ok) {
        Alert.alert('Server Status', 'Server is running and reachable. Please try authentication again.');
      } else {
        Alert.alert('Server Status', 'Server is not responding correctly. Please check server logs.');
      }
    } catch (error) {
      Alert.alert('Server Status', 'Cannot reach server. Please check if server is running and network connection is available.');
    }
  };

  const checkTokenExpiry = async () => {
    const now = Date.now() / 1000;
    if (tokenExpiryRef.current && tokenExpiryRef.current <= now + 300) {
      console.log('Token expiring soon, refreshing...');
      try {
        await authenticate();
      } catch (error) {
        console.error('Token refresh failed:', error);
      }
    }
  };

  const sendMessage = async (messageText?: string, messageType: 'text' | 'voice' = 'text') => {
    const textToSend = messageText || input.trim();
    if (!textToSend || loading || !isAuthenticated) return;

    const token = tokenRef.current;
    const sessionId = sessionIdRef.current;

    if (!token || !sessionId) {
      console.error('No authentication token available');
      return;
    }

    await checkTokenExpiry();

    // Close any existing requests
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: textToSend,
      timestamp: new Date(),
      type: messageType,
    };

    setMessages((prev) => [...prev, userMessage]);
    if (!messageText) setInput('');
    setLoading(true);

    const assistantMessageId = Date.now().toString() + '-ai';
    currentMessageRef.current = '';
    
    // Add empty assistant message for streaming
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        isStreaming: true,
        timestamp: new Date(),
        type: 'text',
      },
    ]);

    try {
      await startSSEStream(textToSend, assistantMessageId);
    } catch (error) {
      console.error('Error in sendMessage:', error);
      setMessages(prev => {
        const newMessages = [...prev];
        const messageIndex = newMessages.findIndex(m => m.id === assistantMessageId);
        if (messageIndex !== -1) {
          newMessages[messageIndex] = {
            ...newMessages[messageIndex],
            isStreaming: false,
            error: true,
            content: 'Failed to send message. Please try again.',
          };
        }
        return newMessages;
      });
      setLoading(false);
    }
  };

  const startSSEStream = async (message: string, messageId: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      try {
        const token = tokenRef.current;
        const sessionId = sessionIdRef.current;

        if (!token || !sessionId) {
          throw new Error('No authentication token available');
        }

        console.log('Starting SSE stream for message:', message);
        
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        const url = `${API_BASE_URL}/chat?session_id=${sessionId}`;
        
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('Accept', 'text/event-stream');
        xhr.responseType = 'text';

        let buffer = '';
        let isProcessing = false;
        
        xhr.onprogress = (event) => {
          const newData = xhr.responseText.slice(buffer.length);
          buffer = xhr.responseText;

          const lines = newData.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              
              if (data === '[DONE]') {
                console.log('Stream completed');
                xhrRef.current = null;
                xhr.abort();
                setMessages(prev => prev.map(msg => 
                  msg.id === messageId 
                    ? { ...msg, isStreaming: false, content: currentMessageRef.current } 
                    : msg
                ));
                setLoading(false);
                resolve();
                return;
              }

              if (data.startsWith('Error:')) {
                throw new Error(data);
              }

              try {
                const parsed = JSON.parse(data);

                if (parsed.status === 'processing') {
                  isProcessing = true;
                  continue;
                }

                if (parsed.response !== undefined) {
                  currentMessageRef.current += parsed.response;
                  setMessages(prev => prev.map(msg => 
                    msg.id === messageId 
                      ? { ...msg, content: currentMessageRef.current, isStreaming: true } 
                      : msg
                  ));
                }
              } catch (e) {
                console.warn('Failed to parse SSE data:', data, e);
              }
            }
          }
        };

        xhr.onload = () => {
          console.log('XHR completed with status:', xhr.status);
          xhrRef.current = null;
          if (xhr.status === 200) {
            if (currentMessageRef.current) {
              setMessages(prev => prev.map(msg => 
                msg.id === messageId 
                  ? { ...msg, isStreaming: false, content: currentMessageRef.current } 
                  : msg
              ));
              setLoading(false);
              resolve();
            } else if (!isProcessing) {
              const error = new Error('No response content received');
              setMessages(prev => prev.map(msg => 
                msg.id === messageId 
                  ? { 
                      ...msg, 
                      content: 'No response received. Please try again.',
                      isStreaming: false,
                      error: true
                    } 
                  : msg
              ));
              setLoading(false);
              reject(error);
            }
          } else {
            const error = new Error(`HTTP error! status: ${xhr.status}`);
            setMessages(prev => prev.map(msg => 
              msg.id === messageId 
                ? { 
                    ...msg, 
                    content: 'Connection error. Please try again.',
                    isStreaming: false,
                    error: true
                  } 
                : msg
            ));
            setLoading(false);
            reject(error);
          }
        };

        xhr.onerror = () => {
          console.error('XHR error occurred');
          xhrRef.current = null;
          const error = new Error('Network error occurred');
          setMessages(prev => prev.map(msg => 
            msg.id === messageId 
              ? { 
                  ...msg, 
                  content: 'Connection error. Please try again.',
                  isStreaming: false,
                  error: true
                } 
              : msg
          ));
          setLoading(false);
          reject(error);
        };

        xhr.onabort = () => {
          console.log('XHR request was aborted by user');
          xhrRef.current = null;
          setMessages(prev => prev.map(msg => 
            msg.id === messageId 
              ? { 
                  ...msg, 
                  content: currentMessageRef.current || 'Request stopped by user.',
                  isStreaming: false
                } 
              : msg
          ));
          setLoading(false);
          resolve();
        };

        console.log('Sending XHR request');
        xhr.send(JSON.stringify({
          message: message,
          session_id: sessionId,
          stream: true
        }));

      } catch (error) {
        console.error('Error in startSSEStream:', error);
        setMessages(prev => prev.map(msg => 
          msg.id === messageId 
            ? { 
                ...msg, 
                content: 'Error processing message',
                isStreaming: false,
                error: true
              } 
            : msg
        ));
        setLoading(false);
        reject(error);
      }
    });
  };

  // Voice Recording Functions
  const startRecording = async () => {
    try {
      setIsRecording(true);
      console.log('Starting voice recording...');
      // TODO: Implement actual voice recording
      // Example: recordingRef.current = await AudioRecorder.start();
    } catch (error) {
      console.error('Error starting recording:', error);
      setIsRecording(false);
    }
  };

  const stopRecording = async () => {
    try {
      setIsRecording(false);
      console.log('Stopping voice recording...');
      // TODO: Implement actual voice recording stop and processing
      // Example:
      // const audioFile = await AudioRecorder.stop();
      // const transcript = await sendToSTT(audioFile);
      // sendMessage(transcript, 'voice');
      
      // For demo purposes, simulate voice input
      setTimeout(() => {
        sendMessage("This is a voice message transcription demo", 'voice');
      }, 500);
    } catch (error) {
      console.error('Error stopping recording:', error);
    }
  };

  const toggleLiveVoice = () => {
    if (conversationMode === 'voice_live') {
      setConversationMode('text');
      setIsListening(false);
      console.log('Live voice mode disabled');
    } else {
      setConversationMode('voice_live');
      setIsListening(true);
      console.log('Live voice mode enabled');
      // TODO: Start continuous listening
    }
  };

  const handleVoicePress = () => {
    if (conversationMode === 'voice_record') {
      if (isRecording) {
        stopRecording();
      } else {
        startRecording();
      }
    } else if (conversationMode === 'text') {
      setConversationMode('voice_record');
    }
  };

  const stopStreaming = () => {
    console.log('Stopping stream...');
    
    if (xhrRef.current) {
      console.log('Aborting XHR request');
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    
    if (eventSourceRef.current) {
      console.log('Closing EventSource');
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    
    setLoading(false);

    setMessages(prev => prev.map(msg => 
      msg.isStreaming ? { 
        ...msg, 
        isStreaming: false,
        content: msg.content || 'Request stopped by user.'
      } : msg
    ));
  };

  const clearSession = async () => {
    try {
      if (xhrRef.current) {
        xhrRef.current.abort();
        xhrRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      await Promise.all([
        AsyncStorage.removeItem(TOKEN_KEY),
        AsyncStorage.removeItem(SESSION_KEY),
        AsyncStorage.removeItem(TOKEN_EXPIRY_KEY),
      ]);
      
      tokenRef.current = null;
      sessionIdRef.current = null;
      tokenExpiryRef.current = null;
      setIsAuthenticated(false);
      setMessages([{
        id: '1',
        role: 'assistant',
        content: 'Hi! I\'m your AI banking assistant. How can I help you today?',
        timestamp: new Date(),
        type: 'text',
      }]);
      
      await authenticate();
    } catch (error) {
      console.error('Error clearing session:', error);
    }
  };

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const renderModeIndicator = () => {
    const getIndicatorConfig = () => {
      switch (conversationMode) {
        case 'voice_record':
          return {
            icon: 'mic' as const,
            text: 'Voice Record',
            color: '#FF6B35'
          };
        case 'voice_live':
          return {
            icon: 'radio' as const,
            text: isListening ? 'Listening...' : 'Live Voice',
            color: '#10B981'
          };
        default:
          return {
            icon: 'chatbubble' as const,
            text: 'Text Mode',
            color: '#007AFF'
          };
      }
    };

    const config = getIndicatorConfig();
    
    return (
      <View style={[styles.modeIndicator, theme === 'light' && styles.modeIndicatorLight]}>
        <Ionicons 
          name={config.icon} 
          size={16} 
          color={config.color} 
        />
        <Text style={[styles.modeText, { color: config.color }]}>
          {config.text}
        </Text>
        {(isListening || isRecording) && (
          <Animated.View 
            style={[
              styles.pulseDot,
              {
                backgroundColor: config.color,
                opacity: animationRef,
              }
            ]} 
          />
        )}
      </View>
    );
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    const messageStyle = isUser ? styles.userMessage : styles.assistantMessage;
    const textStyle = isUser ? styles.userText : styles.assistantText;
    const containerStyle = isUser ? styles.userContainer : styles.assistantContainer;

    return (
      <View style={[styles.messageContainer, containerStyle]}>
        <View style={[
          styles.messageBubble,
          messageStyle,
          theme === 'light' && (isUser ? styles.userMessageLight : styles.assistantMessageLight)
        ]}>
          {item.type === 'voice' && (
            <View style={styles.voiceIndicator}>
              <Ionicons 
                name="mic" 
                size={14} 
                color={isUser ? '#ffffff' : (theme === 'light' ? '#007AFF' : '#ffffff')} 
              />
            </View>
          )}
          <Text style={[
            textStyle,
            theme === 'light' && (isUser ? styles.userTextLight : styles.assistantTextLight)
          ]}>
            {item.content}
            {item.isStreaming && !item.error && (
              <Text style={styles.typingIndicator}>▋</Text>
            )}
          </Text>
        </View>
        <Text style={[styles.timestamp, theme === 'light' && styles.timestampLight]}>
          {formatTime(item.timestamp)}
        </Text>
      </View>
    );
  };

  if (authLoading) {
    return (
      <SafeAreaView style={[styles.container, theme === 'light' && styles.containerLight]}>
        <StatusBar
          barStyle={theme === 'dark' ? 'light-content' : 'dark-content'}
          backgroundColor={theme === 'dark' ? '#000000' : '#ffffff'}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={[styles.loadingText, theme === 'light' && styles.loadingTextLight]}>
            Connecting to server...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={[styles.container, theme === 'light' && styles.containerLight]}>
        <StatusBar
          barStyle={theme === 'dark' ? 'light-content' : 'dark-content'}
          backgroundColor={theme === 'dark' ? '#000000' : '#ffffff'}
        />
        <View style={styles.loadingContainer}>
          <Text style={[styles.errorText, theme === 'light' && styles.errorTextLight]}>
            Authentication Required
          </Text>
          <TouchableOpacity onPress={authenticate} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry Connection</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, theme === 'light' && styles.containerLight]}>
      <StatusBar
        barStyle={theme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme === 'dark' ? '#000000' : '#ffffff'}
      />
      
      {/* Header Container with proper separation */}
      <View style={[styles.headerContainer, theme === 'light' && styles.headerContainerLight]}>
        <View style={[styles.header, theme === 'light' && styles.headerLight]}>
          <Text style={[styles.heading, theme === 'light' && styles.headingLight]}>
            AI Banking Assistant
          </Text>
          <View style={styles.headerButtons}>
            {loading && (
              <TouchableOpacity onPress={stopStreaming} style={[styles.stopButton, theme === 'light' && styles.stopButtonLight]}>
                <Text style={[styles.stopButtonText, theme === 'light' && styles.stopButtonTextLight]}>
                  Stop
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={toggleTheme} style={[styles.themeButton, theme === 'light' && styles.themeButtonLight]}>
              <Ionicons name={theme === 'dark' ? 'sunny' : 'moon'} size={20} color={theme === 'dark' ? 'white' : '#333'} />
            </TouchableOpacity>
            <TouchableOpacity onPress={clearSession} style={[styles.refreshButton, theme === 'light' && styles.refreshButtonLight]}>
              <Ionicons name="refresh" size={20} color={theme === 'dark' ? 'white' : '#333'} />
            </TouchableOpacity>
          </View>
        </View>
        
        {/* Mode Indicator */}
        {renderModeIndicator()}
        
        {/* Border separator */}
        <View style={[styles.headerBorder, theme === 'light' && styles.headerBorderLight]} />
      </View>
      
      <View style={styles.content}>
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
          showsVerticalScrollIndicator={false}
        />
      </View>
      
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <View style={[styles.bottomContainer, theme === 'light' && styles.bottomContainerLight]}>
          {/* Conversation Mode Selector */}
          <View style={[styles.modeSelector, theme === 'light' && styles.modeSelectorLight]}>
            <TouchableOpacity 
              style={[
                styles.modeButton,
                conversationMode === 'text' && styles.modeButtonActive,
                theme === 'light' && styles.modeButtonLight,
                conversationMode === 'text' && theme === 'light' && styles.modeButtonActiveLight
              ]}
              onPress={() => setConversationMode('text')}
            >
              <Ionicons 
                name="chatbubble" 
                size={18} 
                color={conversationMode === 'text' 
                  ? '#007AFF' 
                  : (theme === 'light' ? '#666' : '#999')
                } 
              />
              <Text style={[
                styles.modeButtonText,
                conversationMode === 'text' && styles.modeButtonTextActive,
                theme === 'light' && styles.modeButtonTextLight
              ]}>Text</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[
                styles.modeButton,
                conversationMode === 'voice_record' && styles.modeButtonActive,
                theme === 'light' && styles.modeButtonLight,
                conversationMode === 'voice_record' && theme === 'light' && styles.modeButtonActiveLight
              ]}
              onPress={() => setConversationMode('voice_record')}
            >
              <Ionicons 
                name="mic" 
                size={18} 
                color={conversationMode === 'voice_record' 
                  ? '#FF6B35' 
                  : (theme === 'light' ? '#666' : '#999')
                } 
              />
              <Text style={[
                styles.modeButtonText,
                conversationMode === 'voice_record' && styles.modeButtonTextActive,
                theme === 'light' && styles.modeButtonTextLight
              ]}>Record</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[
                styles.modeButton,
                conversationMode === 'voice_live' && styles.modeButtonActive,
                theme === 'light' && styles.modeButtonLight,
                conversationMode === 'voice_live' && theme === 'light' && styles.modeButtonActiveLight
              ]}
              onPress={toggleLiveVoice}
            >
              <Ionicons 
                name="radio" 
                size={18} 
                color={conversationMode === 'voice_live' 
                  ? '#10B981' 
                  : (theme === 'light' ? '#666' : '#999')
                } 
              />
              <Text style={[
                styles.modeButtonText,
                conversationMode === 'voice_live' && styles.modeButtonTextActive,
                theme === 'light' && styles.modeButtonTextLight
              ]}>Live</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.inputContainer, theme === 'light' && styles.inputContainerLight]}>
            <TouchableOpacity 
              style={[styles.iconButton, theme === 'light' && styles.iconButtonLight]}
              onPress={() => {
                console.log('Attachment pressed');
              }}
            >
              <Ionicons
                name="attach"
                size={24}
                color={theme === 'light' ? '#007AFF' : '#ffffff'}
              />
            </TouchableOpacity>

            {conversationMode === 'text' && (
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="Ask about your banking needs..."
                style={[styles.textInput, theme === 'light' && styles.textInputLight]}
                editable={!loading}
                returnKeyType="send"
                onSubmitEditing={() => sendMessage()}
                multiline={true}
                maxLength={1000}
                placeholderTextColor={theme === 'light' ? '#666' : '#999'}
              />
            )}

            {conversationMode === 'voice_record' && (
              <View style={[styles.voiceRecordContainer, theme === 'light' && styles.voiceRecordContainerLight]}>
                {isRecording ? (
                  <Animated.View style={[styles.recordingIndicator, { opacity: animationRef }]}>
                    <Ionicons name="radio-button-on" size={20} color="#FF6B35" />
                    <Text style={[styles.recordingText, theme === 'light' && styles.recordingTextLight]}>
                      Recording...
                    </Text>
                  </Animated.View>
                ) : (
                  <Text style={[styles.voicePrompt, theme === 'light' && styles.voicePromptLight]}>
                    Hold mic to record voice message
                  </Text>
                )}
              </View>
            )}

            {conversationMode === 'voice_live' && (
              <View style={[styles.voiceLiveContainer, theme === 'light' && styles.voiceLiveContainerLight]}>
                {isListening ? (
                  <Animated.View style={[styles.listeningIndicator, { opacity: animationRef }]}>
                    <Ionicons name="radio" size={20} color="#10B981" />
                    <Text style={[styles.listeningText, theme === 'light' && styles.listeningTextLight]}>
                      Listening...
                    </Text>
                  </Animated.View>
                ) : (
                  <Text style={[styles.voicePrompt, theme === 'light' && styles.voicePromptLight]}>
                    Voice mode ready - speak naturally
                  </Text>
                )}
              </View>
            )}

            <TouchableOpacity 
              onPress={loading ? stopStreaming : () => sendMessage()} 
              style={[
                styles.sendButton,
                !input.trim() && !loading && conversationMode === 'text' && styles.sendButtonDisabled,
                theme === 'light' && styles.sendButtonLight
              ]}
              disabled={!input.trim() && !loading && conversationMode === 'text'}
            >
              {loading ? (
                <Ionicons
                  name="stop"
                  size={24}
                  color="#FF3B30"
                />
              ) : (
                <Ionicons
                  name="send"
                  size={24}
                  color={
                    (!input.trim() && conversationMode === 'text') ? '#999' : '#007AFF'
                  }
                />
              )}
            </TouchableOpacity>
          </View>
          
          {/* Quick Actions */}
          <View style={[styles.quickActionsContainer, theme === 'light' && styles.quickActionsContainerLight]}>
            <TouchableOpacity 
              style={[styles.quickActionButton, theme === 'light' && styles.quickActionButtonLight]}
              onPress={() => {
                console.log('Check balance pressed');
              }}
            >
              <Ionicons name="wallet" size={24} color={theme === 'light' ? '#007AFF' : '#ffffff'} />
              <Text style={[styles.quickActionText, theme === 'light' && styles.quickActionTextLight]}>Balance</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.quickActionButton, theme === 'light' && styles.quickActionButtonLight]}
              onPress={() => {
                console.log('Payment pressed');
              }}
            >
              <Ionicons name="card" size={24} color={theme === 'light' ? '#007AFF' : '#ffffff'} />
              <Text style={[styles.quickActionText, theme === 'light' && styles.quickActionTextLight]}>Pay</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.quickActionButton, theme === 'light' && styles.quickActionButtonLight]}
              onPress={() => {
                console.log('Transactions pressed');
              }}
            >
              <Ionicons name="stats-chart" size={24} color={theme === 'light' ? '#007AFF' : '#ffffff'} />
              <Text style={[styles.quickActionText, theme === 'light' && styles.quickActionTextLight]}>Transactions</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.quickActionButton, theme === 'light' && styles.quickActionButtonLight]}
              onPress={() => {
                console.log('Support pressed');
              }}
            >
              <Ionicons name="help-circle" size={24} color={theme === 'light' ? '#007AFF' : '#ffffff'} />
              <Text style={[styles.quickActionText, theme === 'light' && styles.quickActionTextLight]}>Support</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  containerLight: {
    backgroundColor: '#ffffff',
  },
  statusBarSpace: {
    height: Constants.statusBarHeight,
    backgroundColor: '#000000',
  },
  statusBarSpaceLight: {
    backgroundColor: '#ffffff',
  },
  headerContainer: {
    backgroundColor: '#000000',
  },
  headerContainerLight: {
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    height: 56,
    backgroundColor: '#000000',
  },
  headerLight: {
    backgroundColor: '#ffffff',
  },
  modeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 15,
    backgroundColor: '#1a1a1a',
  },
  modeIndicatorLight: {
    backgroundColor: '#f8f9fa',
  },
  modeText: {
    marginLeft: 6,
    fontSize: 14,
    fontWeight: '500',
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 8,
  },
  headerBorder: {
    height: 1,
    backgroundColor: '#333333',
    width: '100%',
  },
  headerBorderLight: {
    backgroundColor: '#e1e5e9',
  },
  heading: {
    fontSize: 20,
    fontWeight: '600',
    color: 'white',
    flex: 1,
  },
  headingLight: {
    color: '#333',
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stopButton: {
    backgroundColor: '#333333',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
  },
  stopButtonLight: {
    backgroundColor: '#e1e5e9',
  },
  stopButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
  },
  stopButtonTextLight: {
    color: '#333',
  },
  themeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#333333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  themeButtonLight: {
    backgroundColor: '#e1e5e9',
  },
  refreshButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#333333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  refreshButtonLight: {
    backgroundColor: '#e1e5e9',
  },
  content: {
    flex: 1,
  },
  messageList: {
    padding: 15,
  },
  messageContainer: {
    marginBottom: 15,
  },
  userContainer: {
    alignItems: 'flex-end',
  },
  assistantContainer: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    padding: 12,
    borderRadius: 18,
    maxWidth: '80%',
  },
  messageBubbleLight: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  userMessage: {
    backgroundColor: '#007AFF',
  },
  userMessageLight: {
    backgroundColor: '#007AFF',
  },
  assistantMessage: {
    backgroundColor: '#1c1c1e',
    borderWidth: 1,
    borderColor: '#333333',
  },
  assistantMessageLight: {
    backgroundColor: '#f5f5f7',
    borderColor: '#e1e5e9',
  },
  voiceIndicator: {
    marginBottom: 4,
  },
  userText: {
    color: '#ffffff',
    fontSize: 16,
    lineHeight: 22,
  },
  userTextLight: {
    color: '#ffffff',
  },
  assistantText: {
    color: '#ffffff',
    fontSize: 16,
    lineHeight: 22,
  },
  assistantTextLight: {
    color: '#000000',
  },
  errorText: {
    color: '#ff3b30',
    fontSize: 18,
    fontWeight: '500',
  },
  errorTextLight: {
    color: '#ff3b30',
  },
  timestamp: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  timestampLight: {
    color: '#999',
  },
  typingIndicator: {
    opacity: 0.7,
    fontWeight: 'bold',
  },
  bottomContainer: {
    backgroundColor: '#000000',
    borderTopWidth: 1,
    borderTopColor: '#333333',
  },
  bottomContainerLight: {
    backgroundColor: '#ffffff',
    borderTopColor: '#e1e5e9',
  },
  modeSelector: {
    flexDirection: 'row',
    paddingHorizontal: 15,
    paddingVertical: 10,
    backgroundColor: '#1a1a1a',
    borderBottomWidth: 1,
    borderBottomColor: '#333333',
  },
  modeSelectorLight: {
    backgroundColor: '#f8f9fa',
    borderBottomColor: '#e1e5e9',
  },
  modeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginHorizontal: 4,
    backgroundColor: 'transparent',
  },
  modeButtonLight: {
    backgroundColor: 'transparent',
  },
  modeButtonActive: {
    backgroundColor: '#333333',
  },
  modeButtonActiveLight: {
    backgroundColor: '#e1e5e9',
  },
  modeButtonText: {
    marginLeft: 6,
    fontSize: 14,
    color: '#999',
    fontWeight: '500',
  },
  modeButtonTextLight: {
    color: '#666',
  },
  modeButtonTextActive: {
    color: '#007AFF',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 10,
    backgroundColor: '#000000',
    alignItems: 'flex-end',
  },
  inputContainerLight: {
    backgroundColor: '#ffffff',
  },
  textInput: {
    flex: 1,
    backgroundColor: '#1c1c1e',
    color: '#ffffff',
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    marginRight: 10,
    fontSize: 16,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: '#333333',
  },
  textInputLight: {
    backgroundColor: '#f5f5f7',
    color: '#000000',
    borderColor: '#e1e5e9',
  },
  voiceRecordContainer: {
    flex: 1,
    backgroundColor: '#1c1c1e',
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 15,
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#333333',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 50,
  },
  voiceRecordContainerLight: {
    backgroundColor: '#f5f5f7',
    borderColor: '#e1e5e9',
  },
  voiceLiveContainer: {
    flex: 1,
    backgroundColor: '#1c1c1e',
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 15,
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#333333',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 50,
  },
  voiceLiveContainerLight: {
    backgroundColor: '#f5f5f7',
    borderColor: '#e1e5e9',
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recordingText: {
    marginLeft: 8,
    color: '#FF6B35',
    fontSize: 16,
    fontWeight: '500',
  },
  recordingTextLight: {
    color: '#FF6B35',
  },
  listeningIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  listeningText: {
    marginLeft: 8,
    color: '#10B981',
    fontSize: 16,
    fontWeight: '500',
  },
  listeningTextLight: {
    color: '#10B981',
  },
  voicePrompt: {
    color: '#999',
    fontSize: 16,
    textAlign: 'center',
  },
  voicePromptLight: {
    color: '#666',
  },
  recordingButton: {
    backgroundColor: '#FF6B35',
  },
  listeningButton: {
    backgroundColor: '#10B981',
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1c1c1e',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333333',
  },
  sendButtonLight: {
    backgroundColor: '#f5f5f7',
    borderColor: '#e1e5e9',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: 'white',
  },
  loadingTextLight: {
    color: '#333',
  },
  retryButton: {
    marginTop: 20,
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  retryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1c1c1e',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: '#333333',
  },
  iconButtonLight: {
    backgroundColor: '#f5f5f7',
    borderColor: '#e1e5e9',
  },
  quickActionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#333333',
    backgroundColor: '#000000',
  },
  quickActionsContainerLight: {
    backgroundColor: '#ffffff',
    borderTopColor: '#e1e5e9',
  },
  quickActionButton: {
    alignItems: 'center',
    padding: 8,
    borderRadius: 12,
    backgroundColor: '#1c1c1e',
    borderWidth: 1,
    borderColor: '#333333',
    minWidth: 80,
  },
  quickActionButtonLight: {
    backgroundColor: '#f5f5f7',
    borderColor: '#e1e5e9',
  },
  quickActionText: {
    color: '#ffffff',
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  quickActionTextLight: {
    color: '#007AFF',
  },
});