Ext.define('pve-ceph-warnings', {
    extend: 'Ext.data.Model',
    fields: [
        'id',
        'summary',
        'detail',
        'severity',
        'muted',
        'canMute',
        'muteValue',
        'muteIcon',
        'muteLabel',
        'cephxMigration',
        'cephxHelpLink',
        'cephxHelpLabel',
        'hasActions',
    ],
    idProperty: 'id',
});

// Ceph reports the same cipher change through several checks, with a detail that lists the
// affected entities but not what to do about them. Keyed by the exact check, so the unrelated
// AUTH_INSECURE_GLOBAL_ID_RECLAIM* checks keep ceph's own text.
const CEPHX_CIPHER_STATUS_HINT = gettext(
    'Cephx key migration checks are active. By themselves, they do not indicate unavailable' +
        ' storage, failed services, or degraded data.',
);

// The onlineHelp property makes the local documentation index include this subsection.
const CEPHX_CIPHER_HELP = {
    onlineHelp: 'pveceph_cephx_migration',
};

const cephxMigrationHintHtml = function () {
    let hint = Ext.htmlEncode(CEPHX_CIPHER_STATUS_HINT);
    let helpLink = Ext.htmlEncode(Proxmox.Utils.get_help_link(CEPHX_CIPHER_HELP.onlineHelp));
    let helpLabel = Ext.htmlEncode(gettext('Cephx migration guide'));

    return (
        '<i class="fa fa-fw fa-info-circle info-blue" aria-hidden="true"></i>' +
        `${hint} <a target="_blank" rel="noopener noreferrer" href="${helpLink}">${helpLabel}</a>`
    );
};

const CEPHX_CIPHER_HOWTO = {
    AUTH_INSECURE_SERVICE_KEY_TYPE: gettext(
        'Use the Cephx migration helper to migrate service daemon keys.',
    ),
    AUTH_INSECURE_SERVICE_TICKETS: gettext(
        'Use the Cephx migration helper to switch service tickets to aes256k.',
    ),
    AUTH_INSECURE_CLIENT_KEY_TYPE: gettext(
        'Use the migration helper for cluster-owned keys and keys of compatible Ceph users.' +
            ' Leave user keys required by incompatible clients unchanged.',
    ),
    AUTH_INSECURE_KEYS_ALLOWED: gettext(
        'Keep aes enabled while any key or client still needs it. Restrict the ciphers only' +
            ' after the migration helper reports no blocker.',
    ),
    AUTH_INSECURE_KEYS_CREATABLE: gettext('Finish the migration after no key or client needs aes.'),
    AUTH_INSECURE_ROTATING_SERVICE_KEY_TYPE: gettext(
        'This usually clears within a few hours after the monitors start issuing aes256k' +
            ' service tickets.',
    ),
};

// The Mute/Unmute button lives in the detail of the row that reports the check, which is
// template markup rather than a component, so the grid catches its events and the check is
// read back off the button.
let cephHealthMuteAction = function (target) {
    let code = target.getAttribute('data-code');
    let panel = Ext.Component.from(target)?.up('pveNodeCephStatus');
    let reload = () => panel?.store.load();

    if (target.getAttribute('data-mute') === '1') {
        Ext.create('PVE.ceph.HealthMute', {
            code: code,
            autoShow: true,
            listeners: { close: reload },
        });
        return;
    }

    Ext.Msg.confirm(
        gettext('Confirm'),
        Ext.String.format(gettext("Unmute health check '{0}'?"), code),
        function (btn) {
            if (btn !== 'yes') {
                return;
            }
            Proxmox.Utils.API2Request({
                url: `/cluster/ceph/health-mute/${code}`,
                method: 'PUT',
                params: { value: 0 },
                failure: (response) => Ext.Msg.alert(gettext('Error'), response.htmlStatus),
                success: reload,
            });
        },
    );
};

Ext.define('PVE.node.CephStatus', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveNodeCephStatus',

    onlineHelp: 'chapter_pveceph',

    scrollable: true,
    bodyPadding: 5,
    layout: {
        type: 'column',
    },

    defaults: {
        padding: 5,
    },

    items: [
        {
            xtype: 'panel',
            title: gettext('Health'),
            bodyPadding: 10,
            plugins: 'responsive',
            responsiveConfig: {
                'width < 1600': {
                    minHeight: 230,
                    columnWidth: 1,
                },
                'width >= 1600': {
                    minHeight: 500,
                    columnWidth: 0.5,
                },
            },
            layout: {
                type: 'hbox',
                align: 'stretch',
            },
            items: [
                {
                    xtype: 'container',
                    layout: {
                        type: 'vbox',
                        align: 'stretch',
                    },
                    flex: 1,
                    items: [
                        {
                            xtype: 'pveHealthWidget',
                            itemId: 'overallhealth',
                            flex: 1,
                            title: gettext('Status'),
                        },
                        {
                            xtype: 'displayfield',
                            itemId: 'versioninfo',
                            fieldLabel: gettext('Ceph Version'),
                            value: '',
                            autoEl: {
                                tag: 'div',
                                'data-qtip': gettext(
                                    'The newest version installed in the Cluster.',
                                ),
                            },
                            padding: '10 0 0 0',
                            style: {
                                'text-align': 'center',
                            },
                        },
                    ],
                },
                {
                    xtype: 'grid',
                    itemId: 'warnings',
                    flex: 2,
                    maxHeight: 430,
                    stateful: true,
                    stateId: 'ceph-status-warnings',
                    viewConfig: {
                        enableTextSelection: true,
                        listeners: {
                            // The button sits in the row body, which is template markup rather
                            // than a component, so the view catches its clicks and the check is
                            // read back off the button.
                            click: {
                                element: 'el',
                                delegate: '.pve-ceph-warning-action',
                                fn: (e, target) => cephHealthMuteAction(target),
                            },
                            collapsebody: function (rowNode, record) {
                                record.set('expanded', false);
                                record.commit();
                            },
                            expandbody: function (rowNode, record) {
                                record.set('expanded', true);
                                record.commit();
                            },
                        },
                    },
                    // we load the store manually, to show an emptyText specify an empty intermediate store
                    store: {
                        type: 'diff',
                        trackRemoved: false,
                        data: [],
                        rstore: {
                            storeid: 'pve-ceph-warnings',
                            type: 'update',
                            model: 'pve-ceph-warnings',
                        },
                    },
                    updateHealth: function (health) {
                        let checks = health.checks || {};
                        // muting needs Sys.Modify, while this panel only needs an audit
                        // privilege, so an audit user must not be offered the action
                        let canMute = !!Ext.state.Manager.get('GuiCap')?.dc['Sys.Modify'];

                        let checkRecords = Object.keys(checks)
                            .sort()
                            .map((key) => {
                                let check = checks[key];
                                let data = {
                                    id: key,
                                    summary: check.summary.message,
                                    detail: check.detail
                                        .reduce((acc, v) => `${acc}\n${v.message}`, '')
                                        .trimStart(),
                                    severity: check.severity,
                                    muted: !!check.muted,
                                    canMute: canMute,
                                };
                                data.muteValue = data.muted ? 0 : 1;
                                data.muteIcon = data.muted ? 'fa-bell' : 'fa-bell-slash';
                                data.muteLabel = data.muted ? gettext('Unmute') : gettext('Mute');
                                let howto = CEPHX_CIPHER_HOWTO[key];
                                data.cephxMigration = !!howto;
                                if (howto) {
                                    data.cephxHelpLink = Proxmox.Utils.get_help_link(
                                        CEPHX_CIPHER_HELP.onlineHelp,
                                    );
                                    data.cephxHelpLabel = gettext('Cephx migration guide');
                                    // ahead of ceph's own detail, which would push this out of view
                                    data.detail = howto + (data.detail ? `\n\n${data.detail}` : '');
                                }
                                data.hasActions = data.cephxMigration || data.canMute;
                                data.noDetails = data.detail.length === 0;
                                data.detailsCls = data.detail.length === 0 ? 'pmx-opacity-75' : '';
                                if (data.detail.length === 0) {
                                    data.detail = 'no additional data';
                                }
                                return data;
                            });

                        let rstore = this.getStore().rstore;
                        rstore.loadData(checkRecords, false);
                        rstore.fireEvent('load', rstore, checkRecords, true);
                    },
                    emptyText: gettext('No Warnings/Errors'),
                    columns: [
                        {
                            dataIndex: 'severity',
                            tooltip: gettext('Severity'),
                            align: 'center',
                            width: 38,
                            renderer: function (value, metaData, record) {
                                if (record.get('muted')) {
                                    metaData.tdAttr = `data-qtip="${Ext.String.htmlEncode(
                                        gettext('Muted in Ceph, ignored for the overall status'),
                                    )}"`;
                                    return '<i class="fa fa-fw faded fa-bell-slash"></i>';
                                }
                                let health = PVE.Utils.map_ceph_health[value];
                                let icon = PVE.Utils.get_health_icon(health);
                                return `<i class="fa fa-fw ${icon}"></i>`;
                            },
                            sorter: {
                                sorterFn: function (a, b) {
                                    let health = ['HEALTH_ERR', 'HEALTH_WARN', 'HEALTH_OK'];
                                    return (
                                        health.indexOf(b.data.severity) -
                                        health.indexOf(a.data.severity)
                                    );
                                },
                            },
                        },
                        {
                            dataIndex: 'summary',
                            header: gettext('Summary'),
                            renderer: function (value, metaData, record, rI, cI, store, view) {
                                if (record.get('expanded')) {
                                    metaData.tdCls = 'pmx-column-wrapped';
                                }
                                if (record.get('muted')) {
                                    metaData.tdCls += ' pmx-opacity-75';
                                }
                                return Ext.htmlEncode(value);
                            },
                            flex: 1,
                        },
                        {
                            xtype: 'actioncolumn',
                            width: 50,
                            align: 'center',
                            tooltip: gettext('Actions'),
                            items: [
                                {
                                    iconCls: 'x-fa fa-clipboard',
                                    tooltip: gettext('Copy to Clipboard'),
                                    handler: function (
                                        grid,
                                        rowindex,
                                        colindex,
                                        item,
                                        e,
                                        { data },
                                    ) {
                                        let detail = data.noDetails ? '' : `\n${data.detail}`;
                                        navigator.clipboard
                                            .writeText(`${data.severity}: ${data.summary}${detail}`)
                                            .catch((err) => Ext.Msg.alert(gettext('Error'), err));
                                    },
                                },
                            ],
                        },
                    ],
                    listeners: {
                        itemdblclick: function (view, record, row, rowIdx, e) {
                            // inspired by Ext.grid.plugin.RowExpander, but for double click
                            let rowNode = view.getNode(rowIdx);
                            let normalRow = Ext.fly(rowNode);

                            let collapsedCls = view.rowBodyFeature.rowCollapsedCls;

                            if (normalRow.hasCls(collapsedCls)) {
                                view.rowBodyFeature.rowExpander.toggleRow(rowIdx, record);
                            }
                        },
                    },
                    plugins: [
                        {
                            ptype: 'rowexpander',
                            expandOnDblClick: false,
                            scrollIntoViewOnExpand: false,
                            rowBodyTpl: [
                                '<pre class="pve-ceph-warning-detail {detailsCls}">',
                                '{detail:htmlEncode}',
                                '</pre>',
                                '<tpl if="hasActions">',
                                '<div class="pve-ceph-warning-actions">',
                                '<tpl if="cephxMigration">',
                                '<a target="_blank" rel="noopener noreferrer"',
                                ' href="{cephxHelpLink:htmlEncode}">{cephxHelpLabel:htmlEncode}</a>',
                                '</tpl>',
                                '<tpl if="canMute">',
                                // ExtJS' own button markup, so that both themes style it
                                '<a class="x-btn x-unselectable x-btn-default-toolbar-small',
                                ' pve-ceph-warning-action" role="button"',
                                ' data-code="{id:htmlEncode}" data-mute="{muteValue}">',
                                '<span class="x-btn-wrap x-btn-wrap-default-toolbar-small">',
                                '<span class="x-btn-button x-btn-button-default-toolbar-small',
                                ' x-btn-button-center x-btn-text x-btn-icon x-btn-icon-left">',
                                '<span class="x-btn-icon-el x-btn-icon-el-default-toolbar-small',
                                ' fa {muteIcon}"></span>',
                                '<span class="x-btn-inner x-btn-inner-default-toolbar-small">',
                                '{muteLabel:htmlEncode}',
                                '</span></span></span></a>',
                                '</tpl>',
                                '</div>',
                                '</tpl>',
                            ],
                        },
                    ],
                },
            ],
        },
        {
            xtype: 'pveCephStatusDetail',
            itemId: 'statusdetail',
            plugins: 'responsive',
            responsiveConfig: {
                'width < 1600': {
                    columnWidth: 1,
                    minHeight: 250,
                },
                'width >= 1600': {
                    columnWidth: 0.5,
                    minHeight: 300,
                },
            },
            title: gettext('Status'),
        },
        {
            xtype: 'pveCephServices',
            title: gettext('Services'),
            itemId: 'services',
            plugins: 'responsive',
            layout: {
                type: 'hbox',
                align: 'stretch',
            },
            responsiveConfig: {
                'width < 1600': {
                    columnWidth: 1,
                    minHeight: 200,
                },
                'width >= 1600': {
                    columnWidth: 0.5,
                    minHeight: 200,
                },
            },
        },
        {
            xtype: 'panel',
            title: gettext('Performance'),
            columnWidth: 1,
            bodyPadding: 5,
            layout: {
                type: 'hbox',
                align: 'center',
            },
            items: [
                {
                    xtype: 'container',
                    flex: 1,
                    items: [
                        {
                            xtype: 'proxmoxGauge',
                            itemId: 'space',
                            title: gettext('Usage'),
                        },
                        {
                            flex: 1,
                            border: false,
                        },
                        {
                            xtype: 'container',
                            itemId: 'recovery',
                            hidden: true,
                            padding: 25,
                            items: [
                                {
                                    xtype: 'pveRunningChart',
                                    itemId: 'recoverychart',
                                    title: gettext('Recovery') + '/ ' + gettext('Rebalance'),
                                    renderer: PVE.Utils.render_bandwidth,
                                    height: 100,
                                },
                                {
                                    xtype: 'progressbar',
                                    itemId: 'recoveryprogress',
                                },
                            ],
                        },
                    ],
                },
                {
                    xtype: 'container',
                    flex: 2,
                    defaults: {
                        padding: 0,
                        height: 100,
                    },
                    items: [
                        {
                            xtype: 'pveRunningChart',
                            itemId: 'reads',
                            title: gettext('Reads'),
                            renderer: PVE.Utils.render_bandwidth,
                        },
                        {
                            xtype: 'pveRunningChart',
                            itemId: 'writes',
                            title: gettext('Writes'),
                            renderer: PVE.Utils.render_bandwidth,
                        },
                        {
                            xtype: 'pveRunningChart',
                            itemId: 'readiops',
                            title: 'IOPS: ' + gettext('Reads'),
                            renderer: Ext.util.Format.numberRenderer('0,000'),
                        },
                        {
                            xtype: 'pveRunningChart',
                            itemId: 'writeiops',
                            title: 'IOPS: ' + gettext('Writes'),
                            renderer: Ext.util.Format.numberRenderer('0,000'),
                        },
                    ],
                },
            ],
        },
    ],

    updateAll: function (store, records, success) {
        if (!success || records.length === 0) {
            return;
        }

        var me = this;
        var rec = records[0];
        me.status = rec.data;

        let checks = rec.data.health?.checks || {};
        let showCephxMigrationHint = Object.keys(checks).some((key) => !!CEPHX_CIPHER_HOWTO[key]);

        // add health panel
        let overallHealth = PVE.Utils.render_ceph_health(rec.data.health || {});
        overallHealth.hintHtml = showCephxMigrationHint ? cephxMigrationHintHtml() : '';
        me.down('#overallhealth').updateHealth(overallHealth);
        me.down('#warnings').updateHealth(rec.data.health || {}); // add errors to gridstore

        me.getComponent('services').updateAll(me.metadata || {}, rec.data);

        me.getComponent('statusdetail').updateAll(me.metadata || {}, rec.data);

        // add performance data
        let pgmap = rec.data.pgmap;
        let used = pgmap.bytes_used;
        let total = pgmap.bytes_total;

        var text = Ext.String.format(
            gettext('{0} of {1}'),
            Proxmox.Utils.render_size(used),
            Proxmox.Utils.render_size(total),
        );

        // update the usage widget
        const usage = total > 0 ? used / total : 0;
        me.down('#space').updateValue(usage, text);

        let readiops = pgmap.read_op_per_sec;
        let writeiops = pgmap.write_op_per_sec;
        let reads = pgmap.read_bytes_sec || 0;
        let writes = pgmap.write_bytes_sec || 0;

        // update the graphs
        me.reads.addDataPoint(reads);
        me.writes.addDataPoint(writes);
        me.readiops.addDataPoint(readiops);
        me.writeiops.addDataPoint(writeiops);

        let degraded = pgmap.degraded_objects || 0;
        let misplaced = pgmap.misplaced_objects || 0;
        let unfound = pgmap.unfound_objects || 0;
        let unhealthy = degraded + unfound + misplaced;
        // update recovery
        if (pgmap.recovering_objects_per_sec !== undefined || unhealthy > 0) {
            let toRecoverObjects =
                pgmap.misplaced_total || pgmap.unfound_total || pgmap.degraded_total || 0;
            if (toRecoverObjects === 0) {
                return; // FIXME: unexpected return and leaves things possible visible when it shouldn't?
            }
            let recovered = toRecoverObjects - unhealthy || 0;
            let speed = pgmap.recovering_bytes_per_sec || 0;

            let recoveryRatio = recovered / toRecoverObjects;
            let txt = `${(recoveryRatio * 100).toFixed(2)}%`;
            if (speed > 0) {
                let obj_per_sec = speed / (4 * 1024 * 1024); // 4 MiB per Object
                let duration = Proxmox.Utils.format_duration_human(unhealthy / obj_per_sec);
                let speedTxt = PVE.Utils.render_bandwidth(speed);
                txt += ` (${speedTxt} - ${duration} left)`;
            }

            me.down('#recovery').setVisible(true);
            me.down('#recoveryprogress').updateValue(recoveryRatio);
            me.down('#recoveryprogress').updateText(txt);
            me.down('#recoverychart').addDataPoint(speed);
        } else {
            me.down('#recovery').setVisible(false);
            me.down('#recoverychart').addDataPoint(0);
        }
    },

    initComponent: function () {
        var me = this;

        var nodename = me.pveSelNode.data.node;

        me.callParent();
        var baseurl = '/api2/json' + (nodename ? '/nodes/' + nodename : '/cluster') + '/ceph';
        me.store = Ext.create('Proxmox.data.UpdateStore', {
            storeid: 'ceph-status-' + (nodename || 'cluster'),
            interval: 5000,
            proxy: {
                type: 'proxmox',
                url: baseurl + '/status',
            },
        });

        me.metadatastore = Ext.create('Proxmox.data.UpdateStore', {
            storeid: 'ceph-metadata-' + (nodename || 'cluster'),
            interval: 15 * 1000,
            proxy: {
                type: 'proxmox',
                url: '/api2/json/cluster/ceph/metadata',
            },
        });

        // save references for the updatefunction
        me.iops = me.down('#iops');
        me.readiops = me.down('#readiops');
        me.writeiops = me.down('#writeiops');
        me.reads = me.down('#reads');
        me.writes = me.down('#writes');

        // manages the "install ceph?" overlay
        PVE.Utils.monitor_ceph_installed(me, me.store, nodename);

        me.mon(me.store, 'load', me.updateAll, me);
        me.mon(
            me.metadatastore,
            'load',
            function (store, records, success) {
                if (!success || records.length < 1) {
                    return;
                }
                me.metadata = records[0].data;

                // update services
                me.getComponent('services').updateAll(me.metadata, me.status || {});

                // update detailstatus panel
                me.getComponent('statusdetail').updateAll(me.metadata, me.status || {});

                let maxversion = [];
                let maxversiontext = '';
                for (const [_nodename, data] of Object.entries(me.metadata.node)) {
                    let version = data.version.parts;
                    if (PVE.Utils.compare_ceph_versions(version, maxversion) > 0) {
                        maxversion = version;
                        maxversiontext = data.version.str;
                    }
                }
                me.down('#versioninfo').setValue(maxversiontext);
            },
            me,
        );

        me.on('destroy', me.store.stopUpdate);
        me.on('destroy', me.metadatastore.stopUpdate);
        me.store.startUpdate();
        me.metadatastore.startUpdate();
    },
});
