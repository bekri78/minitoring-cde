# OpenSky — activation de la correction aviation

Depuis le 18 mars 2026, OpenSky REST n'accepte plus le couple utilisateur/mot de passe en Basic. Le code utilise OAuth2 `client_credentials` et partage un jeton entre les deux collecteurs.

## Configuration Railway (production)

1. Se connecter à son compte OpenSky (https://opensky-network.org/) et créer un **API client** dans la page Account. Ne pas utiliser le login/password du site.
2. Dans Railway, service `minitoring-cde` → Variables, définir :
   - `OPENSKY_CLIENT_ID` : identifiant du client API (terminant normalement par `-api-client`).
   - `OPENSKY_CLIENT_SECRET` : secret associé au client API.
3. **Ne jamais enregistrer ces valeurs sur GitHub, dans la documentation, dans les tickets ni dans les logs.**
4. Les variables historiques `OPENSKY_USER ` et `OPENSKY_PASS ` (avec espaces finaux visibles dans Railway) ne sont plus utilisées par ces deux collecteurs. Après validation, les supprimer pour éviter la confusion.
5. Une fois la pull request fusionnée et le déploiement réussi, consulter les journaux : lignes `[mil-aircraft] opensky...` et `[opensky] cached ... aircraft`. En cas de `HTTP 401/403/429`, vérifier droits, limitations et quotas OpenSky.

Sans les deux nouvelles variables, le client utilise l'accès anonyme (quotas plus faibles et restrictions possibles des hébergeurs). **La correction du code ne garantit pas à elle seule une collecte réussie depuis Railway.** OpenSky précise qu'il peut bloquer certaines adresses d'hébergeurs.

Le collecteur ADS-B existant reste indépendant. Les erreurs OpenSky ne doivent plus être converties silencieusement en « zéro appareil » après l'échec de toutes les régions.

## Qualité des résultats

- Une réponse HTTP 200 n'est pas une preuve de couverture géographique complète.
- Le cache d'aviation OSINT non rafraîchi / en erreur est considéré comme non observable dans les scores.
- Une position d'aéronef civil proche d'un événement **ne corrobore pas** une activité militaire.
- L'API OpenSky et les règles de quotas sont décrites dans la documentation officielle :
  https://openskynetwork.github.io/opensky-api/rest.html

## Vérifications locales

Depuis la racine du dépôt (Node.js >= 18) :

```sh
node --test server/opensky-client.test.js
node --check server/opensky-client.js
node --check server/airFetcher.js
node --check server/aviation-osint.js
```
