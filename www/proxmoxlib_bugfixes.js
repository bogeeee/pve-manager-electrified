Ext.define('Proxmox.form.RRDTypeSelector', {
    extend: 'Ext.form.FieldContainer',
    alias: ['widget.proxmoxRRDTypeSelector'],

    stateful: true,
    stateId: 'proxmoxRRDTypeSelection',
    layout: 'hbox',

    referenceHolder: true,

    // save current selection in the state Provider so RRDView can read it
    getState: function () {
        let me = this;
        let timeframe = me.lookup('timeframe').getValue();
        let max = me.lookup('maximum').pressed;
        let id = timeframe;
        if (max) {
            id += 'max';
        }

        return {
            id,
            timeframe,
            cf: max ? 'MAX' : 'AVERAGE',
        };
    },
    // set selection based on last saved state
    applyState: function (state) {
        if (state && state.id) {
            this.setValue(state.id);
        }
    },

    setValue: function (value) {
        let me = this;
        let timeframe = value;
        let max = value.endsWith('max');
        if (max) {
            timeframe = value.substring(0, value.length - 3);
        }

        me.lookup('timeframe').setValue(timeframe);
        me.lookup(max ? 'maximum' : 'average').setPressed(true);
        me.lookup(!max ? 'maximum' : 'average').setPressed(false);
    },

    items: [
        {
            xtype: 'combobox',
            reference: 'timeframe',
            padding: '0 5 0 0',
            displayField: 'text',
            valueField: 'id',
            editable: false,
            queryMode: 'local',
            value: 'hour',
            store: {
                type: 'array',
                fields: ['id', 'text'],
                data: [
                    ['hour', gettext('Hour')],
                    ['day', gettext('Day')],
                    ['week', gettext('Week')],
                    ['month', gettext('Month')],
                    ['year', gettext('Year')],
                ],
            },
            listeners: {
                change: function () {
                    this.up('proxmoxRRDTypeSelector').saveState();
                },
            },
        },
        {
            xtype: 'segmentedbutton',
            allowMultiple: false,
            allowToggle: true,
            itemCls: 'x-btn-default-toolbar-small proxmox-inline-button',
            items: [
                {
                    text: gettext('Maximum'),
                    reference: 'maximum',
                    style: {
                        'border-top-right-radius': '0px',
                        'border-bottom-right-radius': '0px',
                        'border-right-width': '0px',
                    },
                    handler: function () {
                        this.up('proxmoxRRDTypeSelector').saveState();
                    },
                },
                {
                    text: gettext('Average'),
                    reference: 'average',
                    pressed: true,
                    style: {
                        'border-top-left-radius': '0px',
                        'border-bottom-left-radius': '0px',
                        'border-left-width': '0px',
                    },
                    handler: function () {
                        this.up('proxmoxRRDTypeSelector').saveState();
                    },
                },
            ],
        },
    ],
});