// Some configuration values are complex strings - so we need parsers/generators for them.
Ext.define('PVE.Parser', {
    statics: {
        // this class only contains static functions

        printACME: function (value) {
            if (Ext.isArray(value.domains)) {
                value.domains = value.domains.join(';');
            }
            return PVE.Parser.printPropertyString(value);
        },

        parseACME: function (value) {
            if (!value) {
                return {};
            }

            let res = {};
            try {
                value.split(',').forEach((property) => {
                    let [k, v] = property.split('=', 2);
                    if (Ext.isDefined(v)) {
                        res[k] = v;
                    } else {
                        throw `Failed to parse key-value pair: ${property}`;
                    }
                });
            } catch (err) {
                console.warn(err);
                return undefined;
            }

            if (res.domains !== undefined) {
                res.domains = res.domains.split(/;/);
            }

            return res;
        },

        parseBoolean: function (value, default_value) {
            if (!Ext.isDefined(value)) {
                return default_value;
            }
            value = value.toLowerCase();
            return value === '1' || value === 'on' || value === 'yes' || value === 'true';
        },

        parsePropertyString: function (value, defaultKey) {
            let res = {};

            if (typeof value !== 'string' || value === '') {
                return res;
            }

            try {
                value.split(',').forEach((property) => {
                    let [k, v] = property.split('=', 2);
                    if (Ext.isDefined(v)) {
                        res[k] = v;
                    } else if (Ext.isDefined(defaultKey)) {
                        if (Ext.isDefined(res[defaultKey])) {
                            throw 'defaultKey may be only defined once in propertyString';
                        }
                        res[defaultKey] = k; // k is the value in this case
                    } else {
                        throw `Failed to parse key-value pair: ${property}`;
                    }
                });
            } catch (err) {
                console.warn(err);
                return undefined;
            }

            return res;
        },

        printPropertyString: function (data, defaultKey) {
            var stringparts = [],
                gotDefaultKeyVal = false,
                defaultKeyVal;

            Ext.Object.each(data, function (key, value) {
                if (defaultKey !== undefined && key === defaultKey) {
                    gotDefaultKeyVal = true;
                    defaultKeyVal = value;
                } else if (value !== '') {
                    stringparts.push(key + '=' + value);
                }
            });

            stringparts = stringparts.sort();
            if (gotDefaultKeyVal) {
                stringparts.unshift(defaultKeyVal);
            }

            return stringparts.join(',');
        },

        parseQemuNetwork: function (key, value) {
            if (!(key && value)) {
                return undefined;
            }

            let res = {},
                errors = false;
            Ext.Array.each(value.split(','), function (p) {
                if (!p || p.match(/^\s*$/)) {
                    return undefined; // continue
                }

                let match_res;

                if (
                    (match_res = p.match(
                        /^(ne2k_pci|e1000e?|e1000-82540em|e1000-82544gc|e1000-82545em|vmxnet3|rtl8139|pcnet|virtio|ne2k_isa|i82551|i82557b|i82559er)(=([0-9a-f]{2}(:[0-9a-f]{2}){5}))?$/i,
                    )) !== null
                ) {
                    res.model = match_res[1].toLowerCase();
                    if (match_res[3]) {
                        res.macaddr = match_res[3];
                    }
                } else if ((match_res = p.match(/^bridge=(\S+)$/)) !== null) {
                    res.bridge = match_res[1];
                } else if ((match_res = p.match(/^rate=(\d+(\.\d+)?|\.\d+)$/)) !== null) {
                    res.rate = match_res[1];
                } else if ((match_res = p.match(/^tag=(\d+(\.\d+)?)$/)) !== null) {
                    res.tag = match_res[1];
                } else if ((match_res = p.match(/^firewall=(\d+)$/)) !== null) {
                    res.firewall = match_res[1];
                } else if ((match_res = p.match(/^link_down=(\d+)$/)) !== null) {
                    res.disconnect = match_res[1];
                } else if ((match_res = p.match(/^queues=(\d+)$/)) !== null) {
                    res.queues = match_res[1];
                } else if (
                    (match_res = p.match(/^trunks=(\d+(?:-\d+)?(?:;\d+(?:-\d+)?)*)$/)) !== null
                ) {
                    res.trunks = match_res[1];
                } else if ((match_res = p.match(/^mtu=(\d+)$/)) !== null) {
                    res.mtu = match_res[1];
                } else {
                    errors = true;
                    return false; // break
                }
                return undefined; // continue
            });

            if (errors || !res.model) {
                return undefined;
            }

            return res;
        },

        printQemuNetwork: function (net) {
            var netstr = net.model;
            if (net.macaddr) {
                netstr += '=' + net.macaddr;
            }
            if (net.bridge) {
                netstr += ',bridge=' + net.bridge;
                if (net.tag) {
                    netstr += ',tag=' + net.tag;
                }
                if (net.firewall) {
                    netstr += ',firewall=' + net.firewall;
                }
            }
            if (net.rate) {
                netstr += ',rate=' + net.rate;
            }
            if (net.queues) {
                netstr += ',queues=' + net.queues;
            }
            if (net.disconnect) {
                netstr += ',link_down=' + net.disconnect;
            }
            if (net.trunks) {
                netstr += ',trunks=' + net.trunks;
            }
            if (net.mtu) {
                netstr += ',mtu=' + net.mtu;
            }
            return netstr;
        },

        parseQemuDrive: function (key, value) {
            if (!(key && value)) {
                return undefined;
            }

            const [, bus, index] = key.match(/^([a-z]+)(\d+)$/);
            if (!bus) {
                return undefined;
            }
            let res = {
                interface: bus,
                index,
            };

            var errors = false;
            Ext.Array.each(value.split(','), function (p) {
                if (!p || p.match(/^\s*$/)) {
                    return undefined; // continue
                }
                let match = p.match(/^([a-z_]+)=(\S+)$/);
                if (!match) {
                    if (!p.match(/[=]/)) {
                        res.file = p;
                        return undefined; // continue
                    }
                    errors = true;
                    return false; // break
                }
                let [, k, v] = match;
                if (k === 'volume') {
                    k = 'file';
                }

                if (Ext.isDefined(res[k])) {
                    errors = true;
                    return false; // break
                }

                if (k === 'cache' && v === 'off') {
                    v = 'none';
                }

                res[k] = v;

                return undefined; // continue
            });

            if (errors || !res.file) {
                return undefined;
            }

            return res;
        },

        printQemuDrive: function (drive) {
            var drivestr = drive.file;

            Ext.Object.each(drive, function (key, value) {
                if (
                    !Ext.isDefined(value) ||
                    key === 'file' ||
                    key === 'index' ||
                    key === 'interface'
                ) {
                    return; // continue
                }
                drivestr += ',' + key + '=' + value;
            });

            return drivestr;
        },

        parseIPConfig: function (key, value) {
            if (!(key && value)) {
                return undefined; // continue
            }

            let res = {};
            try {
                value.split(',').forEach((p) => {
                    if (!p || p.match(/^\s*$/)) {
                        return; // continue
                    }

                    const match = p.match(/^(ip|gw|ip6|gw6)=(\S+)$/);
                    if (!match) {
                        throw `could not parse as IP config: ${p}`;
                    }
                    let [, k, v] = match;
                    res[k] = v;
                });
            } catch (err) {
                console.warn(err);
                return undefined; // continue
            }

            return res;
        },

        printIPConfig: function (cfg) {
            return Object.entries(cfg)
                .filter(([k, v]) => v && k.match(/^(ip|gw|ip6|gw6)$/))
                .map(([k, v]) => `${k}=${v}`)
                .join(',');
        },

        parseLxcNetwork: function (value) {
            if (!value) {
                return undefined;
            }

            let data = {};
            value.split(',').forEach((p) => {
                if (!p || p.match(/^\s*$/)) {
                    return; // continue
                }
                let match_res = p.match(/^(bridge|hwaddr|mtu|name|ip|ip6|gw|gw6|tag|rate)=(\S+)$/);
                if (match_res) {
                    data[match_res[1]] = match_res[2];
                } else if ((match_res = p.match(/^firewall=(\d+)$/)) !== null) {
                    data.firewall = PVE.Parser.parseBoolean(match_res[1]);
                } else if ((match_res = p.match(/^link_down=(\d+)$/)) !== null) {
                    data.link_down = PVE.Parser.parseBoolean(match_res[1]);
                } else if ((match_res = p.match(/^host-managed=(\d+)$/)) !== null) {
                    data['host-managed'] = PVE.Parser.parseBoolean(match_res[1]);
                } else if (!p.match(/^type=\S+$/)) {
                    console.warn(`could not parse LXC network string ${p}`);
                }
            });

            return data;
        },

        printLxcNetwork: function (config) {
            let knownKeys = {
                bridge: 1,
                firewall: 1,
                gw6: 1,
                gw: 1,
                hwaddr: 1,
                ip6: 1,
                ip: 1,
                mtu: 1,
                name: 1,
                rate: 1,
                tag: 1,
                link_down: 1,
                'host-managed': 1,
            };
            return Object.entries(config)
                .filter(([k, v]) => v !== undefined && v !== '' && knownKeys[k])
                .map(([k, v]) => `${k}=${v}`)
                .join(',');
        },

        parseLxcMountPoint: function (value) {
            if (!value) {
                return undefined;
            }

            let res = {};
            let errors = false;
            Ext.Array.each(value.split(','), function (p) {
                if (!p || p.match(/^\s*$/)) {
                    return undefined; // continue
                }
                let match = p.match(/^([a-z_]+)=(.+)$/);
                if (!match) {
                    if (!p.match(/[=]/)) {
                        res.file = p;
                        return undefined; // continue
                    }
                    errors = true;
                    return false; // break
                }
                let [, k, v] = match;
                if (k === 'volume') {
                    k = 'file';
                }

                if (Ext.isDefined(res[k])) {
                    errors = true;
                    return false; // break
                }

                res[k] = v;

                return undefined;
            });

            if (errors || !res.file) {
                return undefined;
            }

            const match = res.file.match(/^([a-z][a-z0-9\-_.]*[a-z0-9]):/i);
            if (match) {
                res.storage = match[1];
                res.type = 'volume';
            } else if (res.file.match(/^\/dev\//)) {
                res.type = 'device';
            } else {
                res.type = 'bind';
            }

            return res;
        },

        printLxcMountPoint: function (mp) {
            let drivestr = mp.file;
            for (const [key, value] of Object.entries(mp)) {
                if (
                    !Ext.isDefined(value) ||
                    key === 'file' ||
                    key === 'type' ||
                    key === 'storage'
                ) {
                    continue;
                }
                drivestr += `,${key}=${value}`;
            }
            return drivestr;
        },

        parseStartup: function (value) {
            if (value === undefined) {
                return undefined;
            }

            let res = {};
            try {
                value.split(',').forEach((p) => {
                    if (!p || p.match(/^\s*$/)) {
                        return; // continue
                    }

                    let match_res;
                    if ((match_res = p.match(/^(order)?=(\d+)$/)) !== null) {
                        res.order = match_res[2];
                    } else if ((match_res = p.match(/^up=(\d+)$/)) !== null) {
                        res.up = match_res[1];
                    } else if ((match_res = p.match(/^down=(\d+)$/)) !== null) {
                        res.down = match_res[1];
                    } else {
                        throw `could not parse startup config ${p}`;
                    }
                });
            } catch (err) {
                console.warn(err);
                return undefined;
            }

            return res;
        },

        printStartup: function (startup) {
            let arr = [];
            if (startup.order !== undefined && startup.order !== '') {
                arr.push('order=' + startup.order);
            }
            if (startup.up !== undefined && startup.up !== '') {
                arr.push('up=' + startup.up);
            }
            if (startup.down !== undefined && startup.down !== '') {
                arr.push('down=' + startup.down);
            }

            return arr.join(',');
        },

        parseQemuSmbios1: function (value) {
            let res = value.split(',').reduce((acc, currentValue) => {
                const [k, v] = currentValue.split(/[=](.+)/);
                acc[k] = v;
                return acc;
            }, {});

            if (PVE.Parser.parseBoolean(res.base64, false)) {
                for (const [k, v] of Object.entries(res)) {
                    if (k !== 'uuid') {
                        res[k] = Ext.util.Base64.decode(v);
                    }
                }
            }

            return res;
        },

        printQemuSmbios1: function (data) {
            let base64 = false;
            let datastr = Object.entries(data)
                .map(([key, value]) => {
                    if (value === '') {
                        return undefined;
                    }
                    if (key !== 'uuid') {
                        base64 = true; // smbios values can be arbitrary, so encode and mark config as such
                        value = Ext.util.Base64.encode(value);
                    }
                    return `${key}=${value}`;
                })
                .filter((v) => v !== undefined)
                .join(',');

            if (base64) {
                datastr += ',base64=1';
            }
            return datastr;
        },

        parseTfaConfig: function (value) {
            let res = {};
            value.split(',').forEach((p) => {
                const [k, v] = p.split('=', 2);
                res[k] = v;
            });

            return res;
        },

        parseTfaType: function (value) {
            let match;
            if (!value || !value.length) {
                return undefined;
            } else if (value === 'x!oath') {
                return 'totp';
            } else if ((match = value.match(/^x!(.+)$/)) !== null) {
                return match[1];
            } else {
                return 1;
            }
        },

        parseQemuCpu: function (value) {
            if (!value) {
                return {};
            }

            let res = {};
            let errors = false;
            Ext.Array.each(value.split(','), function (p) {
                if (!p || p.match(/^\s*$/)) {
                    return undefined; // continue
                }

                if (!p.match(/[=]/)) {
                    if (Ext.isDefined(res.cpu)) {
                        errors = true;
                        return false; // break
                    }
                    res.cputype = p;
                    return undefined; // continue
                }

                let match = p.match(/^([a-z_-]+)=(\S+)$/);
                if (!match || Ext.isDefined(res[match[1]])) {
                    errors = true;
                    return false; // break
                }

                let [, k, v] = match;
                res[k] = v;

                return undefined;
            });

            if (errors || !res.cputype) {
                return undefined;
            }

            return res;
        },

        printQemuCpu: function (cpu) {
            let cpustr = cpu.cputype;
            let optstr = '';

            Ext.Object.each(cpu, function (key, value) {
                if (!Ext.isDefined(value) || key === 'cputype') {
                    return; // continue
                }
                optstr += ',' + key + '=' + value;
            });

            if (!cpustr) {
                if (optstr) {
                    return 'kvm64' + optstr;
                } else {
                    return undefined;
                }
            }

            return cpustr + optstr;
        },

        parseSSHKey: function (key) {
            //                |--- options can have quotes--|     type    key        comment
            let keyre = /^(?:((?:[^\s"]|"(?:\\.|[^"\\])*")+)\s+)?(\S+)\s+(\S+)(?:\s+(.*))?$/;
            let typere =
                /^(?:(?:sk-)?(?:ssh-(?:dss|rsa|ed25519)|ecdsa-sha2-nistp\d+)(?:@(?:[a-z0-9_-]+\.)+[a-z]{2,})?)$/;

            let m = key.match(keyre);
            if (!m || m.length < 3 || !m[2]) {
                // [2] is always either type or key
                return null;
            }
            if (m[1] && m[1].match(typere)) {
                return {
                    type: m[1],
                    key: m[2],
                    comment: m[3],
                };
            }
            if (m[2].match(typere)) {
                return {
                    options: m[1],
                    type: m[2],
                    key: m[3],
                    comment: m[4],
                };
            }
            return null;
        },

        parseACMEPluginData: function (data) {
            let res = {};
            let extradata = [];
            data.split('\n').forEach((line) => {
                // capture everything after the first = as value
                let [key, value] = line.split(/[=](.+)/);
                if (value !== undefined) {
                    res[key] = value;
                } else {
                    extradata.push(line);
                }
            });
            return [res, extradata];
        },

        filterPropertyStringList: function (list, filterFn, defaultKey) {
            return list.filter((entry) =>
                filterFn(PVE.Parser.parsePropertyString(entry, defaultKey)),
            );
        },
    },
});
