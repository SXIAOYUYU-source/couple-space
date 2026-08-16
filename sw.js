const CACHE_NAME = "couple-space-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./sw.js",
  "./goeasy.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", function(event){
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache){ return cache.addAll(ASSETS); })
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(key){ return key !== CACHE_NAME; })
          .map(function(key){ return caches.delete(key); })
      );
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener("push", function(event){
  let title = "小禹和小颖的专属空间";
  let body = "有新消息";
  let tag = "chat";
  let url = "./index.html#chat";
  try{
    const data = event.data ? event.data.json() : null;
    if(data){
      title = data.title || title;
      body = data.body || body;
      tag = data.tag || tag;
      url = data.url || url;
    }
  }catch(e){}
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(clients){
      const visible = clients.some(function(client){
        return client.visibilityState === "visible";
      });
      if(visible) return;
      return self.registration.showNotification(title, {
        body: body,
        icon: "./icons/icon-192.png",
        badge: "./icons/icon-192.png",
        tag: tag,
        data: { url: url },
        vibrate: [120, 60, 120]
      });
    })
  );
});

self.addEventListener("notificationclick", function(event){
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "./index.html#chat";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(clients){
      for(const client of clients){
        if("focus" in client){
          client.focus();
          try{
            if(client.url.indexOf("#chat") === -1 && "navigate" in client) client.navigate(url);
          }catch(e){}
          try{ client.postMessage({ type: "open-chat" }); }catch(e){}
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener("fetch", function(event){
  const url = event.request.url;
  if(event.request.method !== "GET") return;
  if(url.indexOf("map.qq.com") !== -1 || url.indexOf("goeasy.io") !== -1 || url.indexOf("unpkg.com") !== -1 || url.indexOf("mapapi") !== -1){
    return;
  }
  if(event.request.mode === "navigate" || url.indexOf("index.html") !== -1){
    event.respondWith(
      fetch(event.request).then(function(response){
        if(response && response.status === 200){
          const copy = response.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(event.request, copy); });
        }
        return response;
      }).catch(function(){
        return caches.match(event.request).then(function(cached){
          return cached || caches.match("./index.html");
        });
      })
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(function(cached){
      if(cached) return cached;
      return fetch(event.request).then(function(response){
        if(response && response.status === 200){
          const copy = response.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(event.request, copy); });
        }
        return response;
      }).catch(function(){
        if(event.request.mode === "navigate") return caches.match("./index.html");
      });
    })
  );
});
