const CACHE_NAME = "couple-space-v2";
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
