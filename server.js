// ═══ 🆕 FIX: Direct price/subscription question handler ═══
  const _isPriceAsk = (() => {
    const _pn = normalizeArabic((_btnNorm || '').toLowerCase());
    return (/(ثمن|سعر|اسعار|بكام|كام|تكلف)/.test(_pn) && /(اشتراك|الاشتراك)/.test(_pn))
        || /^(ثمن|سعر|اسعار)\s*(ال)?(اشتراك)/.test(_pn)
        || /^(الاشتراك|اشتراك)\s*(بكام|كام|سعر|ثمن)/.test(_pn);
  })();

  if (_isPriceAsk) {
    console.log(`💰 Direct price question: "${message}"`);
    let _priceReply = "";
    
    try {
      const _priceInstructions = await loadBotInstructions("sales");
      if (_priceInstructions && openai) {
        const _priceResp = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `أنت مساعد منصة easyT التعليمية. المستخدم بيسأل عن سعر/ثمن الاشتراك.

⛔ تعليمات الأدمن (إجبارية — لازم تلتزم بيها حرفياً):
${_priceInstructions}

═══ طرق الدفع ═══
1. Visa/MasterCard
2. PayPal
3. InstaPay
4. فودافون كاش: 01027007899
5. تحويل بنكي: بنك الإسكندرية — 202069901001
6. Skrill: info@easyt.online

جاوب على سؤال المستخدم بناءً على تعليمات الأدمن فوق.
- لو سأل عن السعر/الثمن → قوله السعر من التعليمات
- لو سأل عن التقسيط → شوف التعليمات وقوله
- بالعامية المصرية وبأسلوب ودود
- استخدم <br> للأسطر الجديدة و <strong> للعناوين`
            },
            { role: "user", content: message }
          ],
          max_tokens: 400,
          temperature: 0.3,
        });
        _priceReply = _priceResp.choices[0].message.content || "";
      }
    } catch (_priceErr) {
      console.error("Price question GPT error:", _priceErr.message);
    }

    if (_priceReply && _priceReply.trim().length > 20) {
      if (!_priceReply.includes('easyt.online/p/subscriptions')) {
        _priceReply += `<br><br><a href="${SUBSCRIPTION_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 صفحة الاشتراك والعروض ←</a>`;
      }
      if (!_priceReply.includes('easyt.online/p/Payments')) {
        _priceReply += `<br><a href="${PAYMENTS_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">💳 صفحة طرق الدفع ←</a>`;
      }
      _priceReply = finalizeReply(markdownToHtml(_priceReply));
      return {
        reply: _priceReply,
        intent: "SUBSCRIPTION",
        suggestions: ["عايز كورس 📘", "🎓 الدبلومات", "📂 الأقسام"],
      };
    }
  }
