Ext.define('pve-ceph-warnings', {
    extend: 'Ext.data.Model',
    fields: ['id', 'summary', 'detail', 'severity'],
    idProperty: 'id',
});

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
                                };
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
                            renderer: function (value) {
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

        // add health panel
        me.down('#overallhealth').updateHealth(PVE.Utils.render_ceph_health(rec.data.health || {}));
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
