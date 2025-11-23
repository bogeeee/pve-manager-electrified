Ext.define('PVE.form.SizeField', {
    extend: 'Ext.form.FieldContainer',
    alias: 'widget.pveSizeField',

    mixins: ['Proxmox.Mixin.CBind'],

    viewModel: {
        data: {
            unit: 'MiB',
            unitPostfix: '',
        },
        formulas: {
            unitlabel: (get) => get('unit') + get('unitPostfix'),
        },
    },

    emptyText: '',

    layout: 'hbox',
    defaults: {
        hideLabel: true,
    },

    units: {
        B: 1,
        KiB: 1024,
        MiB: 1024 * 1024,
        GiB: 1024 * 1024 * 1024,
        TiB: 1024 * 1024 * 1024 * 1024,
        KB: 1000,
        MB: 1000 * 1000,
        GB: 1000 * 1000 * 1000,
        TB: 1000 * 1000 * 1000 * 1000,
    },

    // display unit (TODO: make (optionally) selectable)
    unit: 'MiB',
    unitPostfix: '',

    // use this if the backend saves values in a unit other than bytes, e.g.,
    // for KiB set it to 'KiB'
    backendUnit: undefined,

    // allow setting 0 and using it as a submit value
    allowZero: false,

    emptyValue: null,

    items: [
        {
            xtype: 'numberfield',
            cbind: {
                name: '{name}',
                emptyText: '{emptyText}',
                allowZero: '{allowZero}',
                emptyValue: '{emptyValue}',
            },
            minValue: 0,
            step: 1,
            submitLocaleSeparator: false,
            fieldStyle: 'text-align: right',
            flex: 1,
            enableKeyEvents: true,
            setValue: function (v) {
                if (!this._transformed && v !== null) {
                    let fieldContainer = this.up('fieldcontainer');
                    let vm = fieldContainer.getViewModel();
                    let unit = vm.get('unit');

                    v /= fieldContainer.units[unit];
                    v *= fieldContainer.backendFactor;

                    this._transformed = true;
                }

                if (Number(v) === 0 && !this.allowZero) {
                    v = undefined;
                }

                return Ext.form.field.Text.prototype.setValue.call(this, v);
            },
            getSubmitValue: function () {
                let v = this.processRawValue(this.getRawValue());
                v = v.replace(this.decimalSeparator, '.');

                if (v === undefined || v === '') {
                    return this.emptyValue;
                }

                if (Number(v) === 0) {
                    return this.allowZero ? 0 : null;
                }

                let fieldContainer = this.up('fieldcontainer');
                let vm = fieldContainer.getViewModel();
                let unit = vm.get('unit');

                v = parseFloat(v) * fieldContainer.units[unit];
                v /= fieldContainer.backendFactor;

                return String(Math.floor(v));
            },
            listeners: {
                // our setValue gets only called if we have a value, avoid
                // transformation of the first user-entered value
                keydown: function () {
                    this._transformed = true;
                },
            },
        },
        {
            xtype: 'displayfield',
            name: 'unit',
            submitValue: false,
            padding: '0 0 0 10',
            bind: {
                value: '{unitlabel}',
            },
            listeners: {
                change: (f, v) => {
                    f.originalValue = v;
                },
            },
            width: 40,
        },
    ],

    initComponent: function () {
        let me = this;

        me.unit = me.unit || 'MiB';
        if (!(me.unit in me.units)) {
            throw 'unknown unit: ' + me.unit;
        }

        me.backendFactor = 1;
        if (me.backendUnit !== undefined) {
            if (!(me.unit in me.units)) {
                throw 'unknown backend unit: ' + me.backendUnit;
            }
            me.backendFactor = me.units[me.backendUnit];
        }

        me.callParent(arguments);

        me.getViewModel().set('unit', me.unit);
        me.getViewModel().set('unitPostfix', me.unitPostfix);
    },
});

Ext.define('PVE.form.BandwidthField', {
    extend: 'PVE.form.SizeField',
    alias: 'widget.pveBandwidthField',

    unitPostfix: '/s',
});
