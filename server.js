async function sendMessage() {
  const userMessage = input.value.trim();
  if (!userMessage) return;

  addMessage(userMessage, "user");
  input.value = "";

  try {
    const response = await fetch("http://localhost:3000/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: userMessage,
        session_id: sessionId
      })
    });

    const data = await response.json();

    if (data.reply) {
      addMessage(data.reply, "bot");
    } else {
      addMessage("حدث خطأ في الرد", "bot");
      console.log(data);
    }

  } catch (error) {
    addMessage("خطأ في الاتصال بالسيرفر", "bot");
    console.error(error);
  }
}
