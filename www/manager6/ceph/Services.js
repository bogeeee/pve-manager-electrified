Ext.define('PVE.ceph.Services', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveCephServices',

    layout: {
        type: 'hbox',
        align: 'stretch',
    },

    bodyPadding: '0 5 20',
    defaults: {
        xtype: 'box',
        style: {
            'text-align': 'center',
        },
    },

    items: [
        {
            flex: 1,
            xtype: 'pveCephServiceList',
            itemId: 'mons',
            title: gettext('Monitors'),
        },
        {
            flex: 1,
            xtype: 'pveCephServiceList',
            itemId: 'mgrs',
            title: gettext('Managers'),
        },
        {
            flex: 1,
            xtype: 'pveCephServiceList',
            itemId: 'mdss',
            title: gettext('Metadata Servers'),
        },
    ],

    updateAll: function (metadata, status) {
        var me = this;

        const healthstates = {
            HEALTH_UNKNOWN: 0,
            HEALTH_ERR: 1,
            HEALTH_WARN: 2,
            HEALTH_UPGRADE: 3,
            HEALTH_OLD: 4,
            HEALTH_OK: 5,
        };
        // order guarantee since es2020, but browsers did so before. Note, integers would break it.
        const healthmap = Object.keys(healthstates);
        let maxversion = '00.0.00';
        Object.values(metadata.node || {}).forEach(function (node) {
            if (PVE.Utils.compare_ceph_versions(node?.version?.parts, maxversion) > 0) {
                maxversion = node?.version?.parts;
            }
        });
        var quorummap = status && status.quorum_names ? status.quorum_names : [];
        let monmessages = {},
            mgrmessages = {},
            mdsmessages = {};
        if (status) {
            if (status.health) {
                Ext.Object.each(status.health.checks, function (key, value, _obj) {
                    if (!Ext.String.startsWith(key, 'MON_')) {
                        return;
                    }
                    for (let i = 0; i < value.detail.length; i++) {
                        let match = value.detail[i].message.match(/mon.([a-zA-Z0-9\-.]+)/);
                        if (!match) {
                            continue;
                        }
                        let monid = match[1];
                        if (!monmessages[monid]) {
                            monmessages[monid] = {
                                worstSeverity: healthstates.HEALTH_OK,
                                messages: [],
                            };
                        }

                        let severityIcon = PVE.Utils.get_ceph_icon_html(value.severity, true);
                        let details = value.detail.reduce((acc, v) => `${acc}\n${v.message}`, '');
                        monmessages[monid].messages.push(severityIcon + details);

                        if (healthstates[value.severity] < monmessages[monid].worstSeverity) {
                            monmessages[monid].worstSeverity = healthstates[value.severity];
                        }
                    }
                });
            }

            if (status.mgrmap) {
                mgrmessages[status.mgrmap.active_name] = 'active';
                status.mgrmap.standbys.forEach(function (mgr) {
                    mgrmessages[mgr.name] = 'standby';
                });
            }

            if (status.fsmap) {
                status.fsmap.by_rank.forEach(function (mds) {
                    mdsmessages[mds.name] = 'rank: ' + mds.rank + '; ' + mds.status;
                });
            }
        }

        let checks = {
            mon: function (mon) {
                if (quorummap.indexOf(mon.name) !== -1) {
                    mon.health = healthstates.HEALTH_OK;
                } else {
                    mon.health = healthstates.HEALTH_ERR;
                }
                if (monmessages[mon.name]) {
                    if (monmessages[mon.name].worstSeverity < mon.health) {
                        mon.health = monmessages[mon.name].worstSeverity;
                    }
                    Array.prototype.push.apply(mon.messages, monmessages[mon.name].messages);
                }
                return mon;
            },
            mgr: function (mgr) {
                if (mgrmessages[mgr.name] === 'active') {
                    mgr.title = '<b>' + mgr.title + '</b>';
                    mgr.statuses.push(gettext('Status') + ': <b>active</b>');
                } else if (mgrmessages[mgr.name] === 'standby') {
                    mgr.statuses.push(gettext('Status') + ': standby');
                } else if (mgr.health > healthstates.HEALTH_WARN) {
                    mgr.health = healthstates.HEALTH_WARN;
                }

                return mgr;
            },
            mds: function (mds) {
                if (mdsmessages[mds.name]) {
                    mds.title = '<b>' + mds.title + '</b>';
                    mds.statuses.push(gettext('Status') + ': <b>' + mdsmessages[mds.name] + '</b>');
                } else if (mds.addr !== Proxmox.Utils.unknownText) {
                    mds.statuses.push(gettext('Status') + ': standby');
                }

                return mds;
            },
        };

        for (let type of ['mon', 'mgr', 'mds']) {
            let ids = Object.keys(metadata[type] || {});
            me[type] = {};

            for (let id of ids) {
                const [name, host] = id.split('@');
                let result = {
                    id: id,
                    health: healthstates.HEALTH_OK,
                    statuses: [],
                    messages: [],
                    name: name,
                    title: metadata[type][id].name || name,
                    host: host,
                    version: PVE.Utils.parse_ceph_version(metadata[type][id]),
                    service: metadata[type][id].service,
                    addr:
                        metadata[type][id].addr ||
                        metadata[type][id].addrs ||
                        Proxmox.Utils.unknownText,
                };

                result.statuses = [
                    gettext('Host') + ': ' + host,
                    gettext('Address') + ': ' + result.addr,
                ];

                if (checks[type]) {
                    result = checks[type](result);
                }

                if (result.service && !result.version) {
                    result.messages.push(
                        PVE.Utils.get_ceph_icon_html('HEALTH_UNKNOWN', true) + gettext('Stopped'),
                    );
                    result.health = healthstates.HEALTH_UNKNOWN;
                }

                if (!result.version && result.addr === Proxmox.Utils.unknownText) {
                    result.health = healthstates.HEALTH_UNKNOWN;
                }

                if (result.version) {
                    result.statuses.push(gettext('Version') + ': ' + result.version);

                    if (PVE.Utils.compare_ceph_versions(result.version, maxversion) !== 0) {
                        let host_version =
                            metadata.node[host]?.version?.parts || metadata.version?.[host] || '';
                        if (PVE.Utils.compare_ceph_versions(host_version, maxversion) === 0) {
                            if (result.health > healthstates.HEALTH_OLD) {
                                result.health = healthstates.HEALTH_OLD;
                            }
                            result.messages.push(
                                PVE.Utils.get_ceph_icon_html('HEALTH_OLD', true) +
                                    gettext(
                                        'A newer version was installed but old version still running, please restart',
                                    ),
                            );
                        } else {
                            if (result.health > healthstates.HEALTH_UPGRADE) {
                                result.health = healthstates.HEALTH_UPGRADE;
                            }
                            result.messages.push(
                                PVE.Utils.get_ceph_icon_html('HEALTH_UPGRADE', true) +
                                    gettext(
                                        'Other cluster members use a newer version of this service, please upgrade and restart',
                                    ),
                            );
                        }
                    }
                }

                result.statuses.push(''); // empty line
                result.text = result.statuses.concat(result.messages).join('<br>');

                result.health = healthmap[result.health];

                me[type][id] = result;
            }
        }

        me.getComponent('mons').updateAll(Object.values(me.mon));
        me.getComponent('mgrs').updateAll(Object.values(me.mgr));
        me.getComponent('mdss').updateAll(Object.values(me.mds));
    },
});

Ext.define('PVE.ceph.ServiceList', {
    extend: 'Ext.container.Container',
    xtype: 'pveCephServiceList',

    style: {
        'text-align': 'center',
    },
    defaults: {
        xtype: 'box',
        style: {
            'text-align': 'center',
        },
    },

    items: [
        {
            itemId: 'title',
            data: {
                title: '',
            },
            tpl: '<h3>{title}</h3>',
        },
    ],

    updateAll: function (list) {
        var me = this;
        me.suspendLayout = true;

        list.sort((a, b) => (a.id > b.id ? 1 : a.id < b.id ? -1 : 0));
        if (!me.ids) {
            me.ids = [];
        }
        let pendingRemoval = {};
        me.ids.forEach((id) => {
            pendingRemoval[id] = true;
        }); // mark all as to-remove first here

        for (let i = 0; i < list.length; i++) {
            let service = me.getComponent(list[i].id);
            if (!service) {
                // services and list are sorted, so just insert at i + 1 (first el. is the title)
                service = me.insert(i + 1, {
                    xtype: 'pveCephServiceWidget',
                    itemId: list[i].id,
                });
                me.ids.push(list[i].id);
            } else {
                delete pendingRemoval[list[i].id]; // drop existing from for-removal
            }
            service.updateService(list[i].title, list[i].text, list[i].health);
        }
        Object.keys(pendingRemoval).forEach((id) => me.remove(id)); // GC

        me.suspendLayout = false;
        me.updateLayout();
    },

    initComponent: function () {
        var me = this;
        me.callParent();
        me.getComponent('title').update({
            title: me.title,
        });
    },
});

Ext.define('PVE.ceph.ServiceWidget', {
    extend: 'Ext.Component',
    alias: 'widget.pveCephServiceWidget',

    userCls: 'monitor inline-block',
    data: {
        title: '0',
        health: 'HEALTH_ERR',
        text: '',
        iconCls: PVE.Utils.get_health_icon(),
    },

    tpl: ['{title}: ', '<i class="fa fa-fw {iconCls}"></i>'],

    updateService: function (title, text, health) {
        var me = this;

        me.update(
            Ext.apply(me.data, {
                health: health,
                text: text,
                title: title,
                iconCls: PVE.Utils.get_health_icon(PVE.Utils.map_ceph_health[health]),
            }),
        );

        if (me.tooltip) {
            me.tooltip.setHtml(text);
        }
    },

    listeners: {
        destroy: function () {
            let me = this;
            if (me.tooltip) {
                me.tooltip.destroy();
                delete me.tooltip;
            }
        },
        mouseenter: {
            element: 'el',
            fn: function (events, element) {
                let view = this.component;
                if (!view) {
                    return;
                }
                if (!view.tooltip || view.data.text !== view.tooltip.html) {
                    view.tooltip = Ext.create('Ext.tip.ToolTip', {
                        target: view.el,
                        trackMouse: true,
                        dismissDelay: 0,
                        renderTo: Ext.getBody(),
                        html: view.data.text,
                    });
                }
                view.tooltip.show();
            },
        },
        mouseleave: {
            element: 'el',
            fn: function (events, element) {
                let view = this.component;
                if (view.tooltip) {
                    view.tooltip.destroy();
                    delete view.tooltip;
                }
            },
        },
    },
});
