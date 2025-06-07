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
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hi! How can I help you with your banking today?',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const streamingRef = useRef(false);
  const currentStreamingIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    flatListRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    // Cancel any ongoing polling
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
    };

    const currentInput = input;
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    const assistantMessageId = Date.now().toString() + '-ai';
    currentStreamingIdRef.current = assistantMessageId;
    
    // Add empty assistant message for streaming
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        isStreaming: true,
      },
    ]);
    streamingRef.current = true;

    // Create new AbortController for this request
    abortControllerRef.current = new AbortController();

    try {
      console.log('Starting streaming with polling approach...');
      
      // Start streaming session
      const sessionResponse = await fetch('http://192.168.0.186:8080/chat/stream', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: currentInput }),
        signal: abortControllerRef.current.signal,
      });

      if (!sessionResponse.ok) {
        throw new Error(`HTTP error! Status: ${sessionResponse.status}`);
      }

      const sessionData = await sessionResponse.json();
      const sessionId = sessionData.session_id;
      
      console.log('Started session:', sessionId);
      
      // Start polling for updates
      await pollForUpdates(sessionId, assistantMessageId);

    } catch (err) {
      console.error("Streaming error:", err);
      
      // Don't show error if request was aborted intentionally
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('Request was aborted');
        return;
      }
      
      setMessages(prev => prev.map(msg => 
        msg.id === assistantMessageId 
          ? { 
              ...msg, 
              content: `Sorry, I encountered an error: ${err instanceof Error ? err.message : 'Unknown error'}. Please check if the server is running and accessible.`,
              isStreaming: false 
            } 
          : msg
      ));
    } finally {
      setLoading(false);
      streamingRef.current = false;
      currentStreamingIdRef.current = null;
      abortControllerRef.current = null;
    }
  };

  const pollForUpdates = async (sessionId: string, messageId: string) => {
    let lastLength = 0;
    
    while (streamingRef.current && currentStreamingIdRef.current === messageId) {
      try {
        const pollResponse = await fetch(`http://192.168.0.186:8080/chat/poll/${sessionId}`, {
          method: 'GET',
          signal: abortControllerRef.current?.signal,
        });

        if (!pollResponse.ok) {
          throw new Error(`Poll error! Status: ${pollResponse.status}`);
        }

        const pollData = await pollResponse.json();
        const { content, done } = pollData;

        // Update message with new content (only if there's new content)
        if (content && content.length > lastLength) {
          const newContent = content.substring(lastLength);
          lastLength = content.length;
          
          setMessages(prev => prev.map(msg => 
            msg.id === messageId 
              ? { ...msg, content: content } 
              : msg
          ));

          console.log('Received new content:', newContent);
        }

        // Check if streaming is complete
        if (done) {
          console.log('Streaming completed');
          setMessages(prev => prev.map(msg => 
            msg.id === messageId 
              ? { ...msg, isStreaming: false } 
              : msg
          ));
          break;
        }

        // Wait before next poll (adjust this for responsiveness vs server load)
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          console.log('Polling aborted');
          break;
        }
        console.error('Polling error:', error);
        throw error;
      }
    }
  };

  const stopStreaming = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    streamingRef.current = false;
    currentStreamingIdRef.current = null;
    setLoading(false);

    // Mark current streaming message as complete
    setMessages(prev => prev.map(msg => 
      msg.isStreaming ? { ...msg, isStreaming: false } : msg
    ));
  };

  const renderItem = ({ item }: { item: Message }) => (
    <View
      style={[
        styles.messageContainer,
        item.role === 'user' ? styles.userMessage : styles.aiMessage,
      ]}
    >
      <Text style={[
        styles.messageText,
        item.role === 'user' && styles.userMessageText
      ]}>
        {item.content}
        {item.isStreaming && (
          <Text style={styles.typingIndicator}>
            <Text style={styles.cursor}>|</Text>
          </Text>
        )}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.heading}>AI Banking Assistant</Text>
        {loading && (
          <TouchableOpacity onPress={stopStreaming} style={styles.stopButton}>
            <Text style={styles.stopButtonText}>Stop</Text>
          </TouchableOpacity>
        )}
      </View>
      
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
      >
        <View style={styles.content}>
          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messageList}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustContentInsets={false}
            onContentSizeChange={() => 
              setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100)
            }
            onLayout={() => 
              setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100)
            }
          />
          
          <View style={styles.inputContainer}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Ask about your banking needs..."
              style={styles.textInput}
              editable={!loading}
              returnKeyType="send"
              onSubmitEditing={sendMessage}
              multiline={false}
            />
            <TouchableOpacity 
              onPress={loading ? stopStreaming : sendMessage} 
              style={[
                styles.sendButton,
                !input.trim() && !loading && styles.sendButtonDisabled
              ]}
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
                  color={!input.trim() ? '#999' : '#007AFF'}
                />
              )}
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
    backgroundColor: '#f8f9fa',
  },
  header: {
    paddingTop: Constants.statusBarHeight,
    backgroundColor: '#007AFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: {
    fontSize: 20,
    fontWeight: '600',
    paddingHorizontal: 15,
    paddingVertical: 15,
    textAlign: 'center',
    color: 'white',
    flex: 1,
  },
  stopButton: {
    position: 'absolute',
    right: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
  },
  stopButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'space-between',
  },
  messageList: {
    flexGrow: 1,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  messageContainer: {
    borderRadius: 18,
    marginVertical: 3,
    padding: 12,
    maxWidth: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#007AFF',
  },
  aiMessage: {
    alignSelf: 'flex-start',
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#e1e5e9',
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
    color: '#333',
  },
  userMessageText: {
    color: 'white',
  },
  typingIndicator: {
    marginLeft: 2,
  },
  cursor: {
    color: '#007AFF',
    fontWeight: 'bold',
    fontSize: 18,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderTopColor: '#e1e5e9',
    borderTopWidth: 1,
    backgroundColor: 'white',
    paddingBottom: Platform.OS === 'ios' ? 10 : 15,
  },
  textInput: {
    flex: 1,
    borderColor: '#e1e5e9',
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#f8f9fa',
    marginRight: 10,
    maxHeight: 100,
    minHeight: 44,
  },
  sendButton: {
    padding: 12,
    borderRadius: 22,
    backgroundColor: '#f0f0f0',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
});